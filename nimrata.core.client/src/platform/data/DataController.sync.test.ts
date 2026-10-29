import { describe, expect, it } from 'vitest';

import { createDataController } from './DataController';
import { createFakeApi, postChangeset } from './fakeApi';

import type { RemoteChanges } from './dataStore';

const types = [
    { id: 'Folder', name: 'Папка', extension: 't', extensionVersion: 1 },
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        properties: [
            { id: 'title', name: 'Название', kind: 'string' },
            { id: 'done', name: 'Готово', kind: 'boolean' },
        ],
    },
];

const objects = [
    { id: 'root', type: 'Folder', parent: null, number: 1, properties: {} },
    { id: 'a', type: 'Note', parent: 'root', number: 1, properties: { title: 'A' } },
    { id: 'b', type: 'Note', parent: 'root', number: 2, properties: { title: 'B' } },
];

async function loaded() {
    const api = createFakeApi(types, structuredClone(objects));
    const data = createDataController({ api });
    await data.load();
    return { api, data };
}

/**
 * Догоняет контроллер изменениями подставного сервера через вход хранилища
 */
async function catchUp(
    api: ReturnType<typeof createFakeApi>,
    data: ReturnType<typeof createDataController>,
) {
    const changes = await api.get<RemoteChanges>(`changes?since=${data.sync.getSeq()}`);
    data.sync.applyRemote(changes);
}

/**
 * Контроллер данных: два слоя и синхронизация
 */
describe('DataController: two layers and sync', () => {
    /**
     * Проверяет, что загрузка берёт снимок с курсором сервера
     */
    it('load_takesSnapshotWithServerCursor', async () => {
        const api = createFakeApi(types, structuredClone(objects));
        await postChangeset(api, [
            { op: 'update', id: 'a', changes: { title: { old: 'A', new: 'X' } } },
        ]);
        const data = createDataController({ api });

        await data.load();

        expect(data.sync.getSeq()).toBe(1);
        expect(data.getObject('a')).toBeDefined();
    });

    /**
     * Проверяет, что следующее действие применяется сразу, не дожидаясь ответа сервера на предыдущее,
     * а неподтверждённые наборы видны в очереди
     */
    it('changes_nextActionDoesNotWaitForServer', async () => {
        const { api, data } = await loaded();
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const post = api.post.bind(api);
        api.post = async (path, body) => {
            await gate;
            return post(path, body);
        };

        const first = data.setProperty('a', 'title', 'X');
        const second = data.setProperty('b', 'title', 'Y');
        // Локальная часть обоих действий выполнилась, ответа сервера ещё нет
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(data.getObject('a')?.properties.title).toBe('X');
        expect(data.getObject('b')?.properties.title).toBe('Y');
        expect(data.sync.pending()).toHaveLength(2);

        release();
        expect(await first).toEqual({ ok: true });
        expect(await second).toEqual({ ok: true });
        expect(data.sync.pending()).toEqual([]);
        expect(api.changesets).toHaveLength(2);
    });

    /**
     * Проверяет, что подтверждённый набор сдвигает курсор и не дублируется при догоне
     */
    it('confirm_advancesCursor_catchUpRecognizesOwnChangeset', async () => {
        const { api, data } = await loaded();
        await data.setProperty('a', 'title', 'X');
        expect(data.sync.getSeq()).toBe(1);

        await catchUp(api, data);

        expect(data.getObject('a')?.properties.title).toBe('X');
        expect(data.sync.pending()).toEqual([]);
    });

    /**
     * Проверяет, что изменения другой вкладки приходят догоном, а своя неподтверждённая правка остаётся сверху
     */
    it('applyRemote_otherTabChange_appliedUnderOwnPendingEdit', async () => {
        const { api, data } = await loaded();
        await postChangeset(api, [
            {
                op: 'update',
                id: 'a',
                changes: { title: { old: 'A', new: 'Чужое' }, done: { old: null, new: true } },
            },
        ]);
        let objectCalls = 0;
        data.subscribeObject('b', () => objectCalls++);

        await catchUp(api, data);

        expect(data.getObject('a')?.properties).toEqual({ title: 'Чужое', done: true });
        expect(data.sync.getSeq()).toBe(1);
        expect(objectCalls).toBe(0);
    });

    /**
     * Проверяет, что отказ созданного набора каскадом отменяет правку созданного объекта
     * и даёт одно сводное уведомление
     */
    it('reject_cascadesToEditOfCreatedObject_withSingleNotice', async () => {
        const { api, data } = await loaded();
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const post = api.post.bind(api);
        api.post = async (path, body) => {
            await gate;
            return post(path, body);
        };
        const errors: (string | null)[] = [];
        data.subscribe(() => errors.push(data.getSnapshot().error));

        const created = await Promise.race([
            data.create({ type: 'Note', parent: 'root', properties: { title: 'Новая' } }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 0)),
        ]);
        expect(created).toBeNull();
        const id = data.getChildren('root').find((o) => o.properties.title === 'Новая')?.id ?? '';
        const edit = data.setProperty(id, 'title', 'Правка');
        api.rejectNext(422, 'нельзя создать');
        release();

        expect(await edit).toMatchObject({ ok: false });
        expect(data.getObject(id)).toBeUndefined();
        expect(api.changesets).toHaveLength(0);
        expect(new Set(errors.filter((e) => e !== null))).toEqual(
            new Set(['нельзя создать Отменены также зависимые изменения: 1.']),
        );
    });
});

/**
 * Контроллер данных: отмена со сверкой текущего значения
 */
describe('DataController: undo checks current value', () => {
    /**
     * Проверяет, что отмена отклоняется с уведомлением, если значение изменили в другом месте,
     * а запись убирается из стека
     */
    it('undo_valueChangedElsewhere_refusedWithNoticeAndEntryDropped', async () => {
        const { api, data } = await loaded();
        await data.setProperty('a', 'title', 'Своё');
        await postChangeset(api, [
            { op: 'update', id: 'a', changes: { title: { old: 'Своё', new: 'Чужое' } } },
        ]);
        await catchUp(api, data);
        const sent = api.changesets.length;

        const result = await data.undo();

        expect(result).toMatchObject({ ok: false });
        expect(data.getSnapshot().error).toBe(
            'Не удалось отменить: данные изменены в другом месте.',
        );
        expect(data.getObject('a')?.properties.title).toBe('Чужое');
        expect(api.changesets).toHaveLength(sent);
        expect(data.canUndo()).toBe(false);
    });

    /**
     * Проверяет, что отмена проходит, если чужая правка не трогала отменяемое значение
     */
    it('undo_otherPropertyChangedElsewhere_undoesOwnValue', async () => {
        const { api, data } = await loaded();
        await data.setProperty('a', 'title', 'Своё');
        await postChangeset(api, [
            { op: 'update', id: 'a', changes: { done: { old: null, new: true } } },
        ]);
        await catchUp(api, data);

        expect(await data.undo()).toEqual({ ok: true });
        expect(data.getObject('a')?.properties).toEqual({ title: 'A', done: true });
    });

    /**
     * Проверяет, что повторная загрузка не отбрасывает неотправленную правку: она уходит на
     * сервер и видна поверх снимка (раньше отклонялась «Данные загружены заново.»)
     */
    it('load_withUnsentEdit_keepsEditAndSendsIt', async () => {
        const api = createFakeApi(types, structuredClone(objects), { extensions: [] });
        const data = createDataController({ api });
        await data.load();
        const outcome = data.setProperty('a', 'title', 'Mine');

        await data.load();

        await expect(outcome).resolves.toEqual({ ok: true });
        expect(api.changesets).toHaveLength(1);
        expect(data.getObject('a')?.properties.title).toBe('Mine');
        expect(data.sync.pending()).toEqual([]);
    });
});
