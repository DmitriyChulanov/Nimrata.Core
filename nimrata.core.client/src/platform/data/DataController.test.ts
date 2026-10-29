import { describe, expect, it } from 'vitest';

import { createDataController } from './DataController';
import { createFakeApi } from './fakeApi';

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
    { id: 'b', type: 'Note', parent: 'root', number: 2, properties: { title: 'B' } },
    { id: 'root', type: 'Folder', parent: null, number: 1, properties: {} },
    { id: 'empty', type: 'Folder', parent: null, number: 2, properties: {} },
    { id: 'a', type: 'Note', parent: 'root', number: 1, properties: { title: 'A' } },
];

async function loaded() {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    return { api, data };
}

/**
 * Контроллер данных: изменения через набор
 */
describe('DataController: changes through a changeset', () => {
    /**
     * Проверяет, что номер нового объекта — максимум среди соседей плюс 1, а в пустом узле — 1
     */
    it('create_withoutNumber_takesMaxSiblingNumberPlusOne', async () => {
        const { data } = await loaded();

        const inRoot = await data.create({ type: 'Note', parent: 'root' });
        const inEmpty = await data.create({ type: 'Note', parent: 'empty' });

        expect(inRoot.ok && data.getObject(inRoot.id)?.number).toBe(3);
        expect(inEmpty.ok && data.getObject(inEmpty.id)?.number).toBe(1);
    });

    /**
     * Проверяет, что создание объекта — один набор с клиентским идентификатором, а объект появляется в модели
     */
    it('create_object_oneChangesetWithClientIdAndObjectAppearsInModel', async () => {
        const { api, data } = await loaded();
        const result = await data.create({
            type: 'Note',
            parent: 'root',
            number: 5,
            properties: { title: 'Новая' },
        });
        expect(result.ok).toBe(true);
        const id = result.ok ? result.id : '';
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
        expect(data.getObject(id)).toEqual({
            id,
            type: 'Note',
            parent: 'root',
            number: 5,
            properties: { title: 'Новая' },
        });
        expect(api.changesets).toEqual([
            {
                id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/),
                operations: [
                    {
                        op: 'create',
                        id,
                        type: 'Note',
                        parent: 'root',
                        number: 5,
                        properties: { title: 'Новая' },
                    },
                ],
            },
        ]);
    });

    /**
     * Проверяет, что каждый набор уходит пакетом со своим идентификатором UUIDv7
     */
    it('changeset_eachSubmission_hasOwnUuid7Id', async () => {
        const { api, data } = await loaded();
        await data.setProperty('a', 'title', 'X');
        await data.setProperty('a', 'title', 'Y');
        const [first, second] = api.changesets.map((c) => c.id);
        expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
        expect(second).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
        expect(first).not.toBe(second);
    });

    /**
     * Проверяет, что создание без порядка добавляет объект последним среди потомков
     */
    it('create_withoutOrder_appendsObjectLastAmongChildren', async () => {
        const { data } = await loaded();
        const result = await data.create({ type: 'Note', parent: 'root' });
        const id = result.ok ? result.id : '';
        expect(data.getObject(id)?.number).toBe(3);
        expect(
            data
                .getChildren('root')
                .map((o) => o.id)
                .at(-1),
        ).toBe(id);
    });

    /**
     * Проверяет, что запись свойства отправляет старое и новое значение, а `null` убирает значение
     */
    it('setProperty_sendsOldAndNew_nullRemovesValue', async () => {
        const { api, data } = await loaded();
        await data.setProperty('a', 'title', 'A2');
        expect(data.getObject('a')?.properties).toEqual({ title: 'A2' });
        await data.setProperty('a', 'title', null);
        expect(data.getObject('a')?.properties).toEqual({});
        expect(api.changesets.map((c) => c.operations)).toEqual([
            [{ op: 'update', id: 'a', changes: { title: { old: 'A', new: 'A2' } } }],
            [{ op: 'update', id: 'a', changes: { title: { old: 'A2', new: null } } }],
        ]);
    });

    /**
     * Проверяет, что перенос меняет родителя и порядок одним набором
     */
    it('move_changesParentAndOrder_inOneChangeset', async () => {
        const { api, data } = await loaded();
        await data.move('a', { parent: null, number: 7 });
        expect(data.getObject('a')).toMatchObject({ parent: null, number: 7 });
        expect(api.changesets[0].operations).toEqual([
            { op: 'move', id: 'a', parent: { old: 'root', new: null }, number: { old: 1, new: 7 } },
        ]);
    });

    /**
     * Проверяет, что перенос только порядка не затрагивает родителя
     */
    it('move_orderOnly_doesNotTouchParent', async () => {
        const { api, data } = await loaded();
        await data.move('a', { number: 9 });
        expect(api.changesets[0].operations).toEqual([
            { op: 'move', id: 'a', number: { old: 1, new: 9 } },
        ]);
    });

    /**
     * Проверяет, что удаление поддерева — один набор, потомки удаляются раньше родителя
     */
    it('remove_subtree_isOneChangesetDescendantsBeforeParent', async () => {
        const { api, data } = await loaded();
        await data.remove('root');
        expect(data.getObject('root')).toBeUndefined();
        expect(data.getObject('a')).toBeUndefined();
        const ids = api.changesets[0].operations.map((o) => o.id);
        expect(api.changesets).toHaveLength(1);
        expect(ids.at(-1)).toBe('root');
        expect([...ids].sort()).toEqual(['a', 'b', 'root']);
        expect(api.changesets[0].operations.every((o) => o.op === 'delete')).toBe(true);
    });

    /**
     * Проверяет, что изменение модели уведомляет подписчиков, а отписавшиеся молчат
     */
    it('subscribe_modelChange_notifiesSubscribersAndUnsubscribedStaySilent', async () => {
        const { data } = await loaded();
        let calls = 0;
        const unsubscribe = data.subscribe(() => calls++);
        const before = data.getSnapshot().version;
        await data.setProperty('a', 'title', 'X');
        expect(calls).toBeGreaterThan(0);
        expect(data.getSnapshot().version).toBeGreaterThan(before);
        unsubscribe();
        calls = 0;
        await data.setProperty('a', 'title', 'Y');
        expect(calls).toBe(0);
    });
});

/**
 * Контроллер данных: отказ, откат, расхождение, перезагрузка
 */
describe('DataController: rejection, rollback, divergence, reload', () => {
    /**
     * Проверяет, что отказ сервера откатывает правку свойства и сообщает причину подписчикам
     */
    it('rejection_serverRejectsPropertyChange_revertsItAndSetsReasonForSubscribers', async () => {
        const { api, data } = await loaded();
        let seen: string | null = null;
        data.subscribe(() => {
            seen ??= data.getSnapshot().error;
        });
        api.rejectNext(422, 'Операция 1: значение не подходит.');
        const result = await data.setProperty('a', 'title', 'Плохо');
        expect(result).toMatchObject({ ok: false, error: 'Операция 1: значение не подходит.' });
        expect(data.getObject('a')?.properties).toEqual({ title: 'A' });
        expect(data.getSnapshot().error).toBe('Операция 1: значение не подходит.');
        expect(data.getSnapshot().needsReload).toBe(false);
        expect(seen).toBe('Операция 1: значение не подходит.');
    });

    /**
     * Проверяет, что отказ сервера откатывает создание, перенос и удаление
     */
    it('rejection_serverRejects_revertsCreateMoveAndRemove', async () => {
        const { api, data } = await loaded();
        const before = JSON.stringify(data.getChildren('root'));

        api.rejectNext(422, 'нет');
        const created = await data.create({ type: 'Note', parent: 'root' });
        expect(created.ok).toBe(false);
        expect(data.getChildren('root')).toHaveLength(2);

        api.rejectNext(422, 'нет');
        await data.move('a', { parent: null, number: 5 });
        expect(data.getObject('a')).toMatchObject({ parent: 'root', number: 1 });

        api.rejectNext(422, 'нет');
        await data.remove('root');
        expect(data.getObject('root')).toBeDefined();
        expect(JSON.stringify(data.getChildren('root'))).toBe(before);
    });

    /**
     * Проверяет, что успешное изменение после отказа очищает ошибку
     */
    it('rejection_successfulChangeAfterRejection_clearsError', async () => {
        const { api, data } = await loaded();
        api.rejectNext(422, 'нет');
        await data.setProperty('a', 'title', 'X');
        await data.setProperty('a', 'title', 'Y');
        expect(data.getSnapshot().error).toBeNull();
        expect(data.getObject('a')?.properties).toEqual({ title: 'Y' });
    });

    /**
     * Проверяет, что 409 из-за расхождения старого значения требует перезагрузки и блокирует правки
     */
    it('rejection_409OldMismatch_setsReloadNeededAndBlocksEdits', async () => {
        const { api, data } = await loaded();
        api.rejectNext(409, 'свойство изменилось с момента загрузки');
        await data.setProperty('a', 'title', 'X');
        expect(data.getSnapshot().needsReload).toBe(true);
        expect(data.getObject('a')?.properties).toEqual({ title: 'A' });

        const blocked = await data.setProperty('a', 'title', 'Z');
        expect(blocked.ok).toBe(false);
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что результат отказа сервера несёт HTTP-код и машинный код ответа
     */
    it('rejection_serverRefusal_resultCarriesStatusAndCode', async () => {
        const { api, data } = await loaded();
        api.rejectNext(409, 'уже есть', 'singleton_exists');
        const result = await data.setProperty('a', 'title', 'X');
        expect(result).toEqual({
            ok: false,
            error: 'уже есть',
            status: 409,
            code: 'singleton_exists',
        });

        await data.load();
        api.rejectNext(422, 'нет');
        expect(await data.setProperty('a', 'title', 'Y')).toMatchObject({
            ok: false,
            status: 422,
        });
    });

    /**
     * Проверяет, что перезагрузка заменяет модель данными сервера и снимает признак
     */
    it('reload_replacesModelWithServerDataAndClearsFlag', async () => {
        const { api, data } = await loaded();
        api.rejectNext(409, 'расхождение');
        await data.setProperty('a', 'title', 'X');
        api.objects = [
            { id: 'z', type: 'Note', parent: null, number: 0, properties: { title: 'Z' } },
        ];
        await data.load();
        expect(data.getSnapshot()).toMatchObject({
            status: 'ready',
            needsReload: false,
            error: null,
        });
        expect(data.getObject('a')).toBeUndefined();
        expect(data.getObject('z')?.properties).toEqual({ title: 'Z' });
        expect((await data.setProperty('z', 'title', 'Q')).ok).toBe(true);
    });

    /**
     * Проверяет, что изменения идут в очереди, а откат одного не затирает следующее
     */
    it('changes_areQueued_rollbackOfOneDoesNotOverwriteNext', async () => {
        const { api, data } = await loaded();
        api.rejectNext(422, 'нет');
        const first = data.setProperty('a', 'title', 'X');
        const second = data.setProperty('b', 'title', 'Y');
        expect((await first).ok).toBe(false);
        expect((await second).ok).toBe(true);
        expect(data.getObject('a')?.properties).toEqual({ title: 'A' });
        expect(data.getObject('b')?.properties).toEqual({ title: 'Y' });
    });

    /**
     * Проверяет, что перенос в собственного потомка отклоняется без отправки набора
     */
    it('move_intoOwnDescendant_isRefusedAndNoChangesetSent', async () => {
        const { api, data } = await loaded();
        const result = await data.move('root', { parent: 'a' });
        expect(result.ok).toBe(false);
        expect(api.changesets).toHaveLength(0);
    });
});

/**
 * Контроллер данных: загрузка и чтение
 */
describe('DataController: loading and reading', () => {
    /**
     * Проверяет, что после загрузки типов и объектов состояние становится «готово»
     */
    it('load_typesAndObjects_thenBecomesReady', async () => {
        const api = createFakeApi(types, objects);
        const data = createDataController({ api });
        expect(data.getSnapshot().status).toBe('idle');
        await data.load();
        expect(data.getSnapshot().status).toBe('ready');
        expect(data.getType('Note')?.name).toBe('Заметка');
        expect(data.getObject('a')?.properties).toEqual({ title: 'A' });
        expect(data.getObject('нет')).toBeUndefined();
    });

    /**
     * Проверяет, что потомки возвращаются по порядку, а для `null` — корни
     */
    it('getChildren_returnsChildrenInOrderAndRootsForNullParent', async () => {
        const { data } = await loaded();
        expect(data.getChildren('root').map((o) => o.id)).toEqual(['a', 'b']);
        expect(data.getChildren(null).map((o) => o.id)).toEqual(['root', 'empty']);
    });

    /**
     * Проверяет, что сбой загрузки переводит в состояние ошибки с причиной
     */
    it('load_failure_becomesErrorWithReason', async () => {
        const api = createFakeApi(types, objects);
        api.get = () => Promise.reject(new Error('сеть недоступна'));
        const data = createDataController({ api });
        await data.load();
        expect(data.getSnapshot().status).toBe('error');
        expect(data.getSnapshot().error).toBe('сеть недоступна');
    });
});

/**
 * Контроллер данных: значения по умолчанию
 */
describe('DataController: default values', () => {
    /**
     * Проверяет, что создание подставляет значения по умолчанию, не перезаписывая заданные
     */
    it('create_appliesPropertyDefaultsWithoutOverwritingGivenValues', async () => {
        const api = createFakeApi(
            [
                {
                    id: 'Task',
                    name: 'Задача',
                    extension: 't',
                    extensionVersion: 1,
                    properties: [
                        { id: 'status', name: 'Статус', kind: 'string', default: 'new' },
                        { id: 'priority', name: 'Приоритет', kind: 'integer', default: 3 },
                        { id: 'note', name: 'Заметка', kind: 'string' },
                    ],
                },
            ],
            [],
        );
        const data = createDataController({ api });
        await data.load();

        const result = await data.create({ type: 'Task', properties: { priority: 7 } });

        const id = result.ok ? result.id : '';
        expect(data.getObject(id)?.properties).toEqual({ status: 'new', priority: 7 });
        expect(api.changesets[0].operations[0].properties).toEqual({ status: 'new', priority: 7 });
    });
});
