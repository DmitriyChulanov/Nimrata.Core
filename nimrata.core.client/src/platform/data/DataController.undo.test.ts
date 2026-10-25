import { describe, expect, it } from 'vitest';

import { createDataController } from './DataController';
import { createFakeApi } from './fakeApi';

const types = [
    { id: 'Folder', name: 'Папка', module: 't', moduleVersion: 1 },
    { id: 'Note', name: 'Заметка', module: 't', moduleVersion: 1 },
];

const objects = [
    { id: 'root', type: 'Folder', parent: null, order: 0, properties: {} },
    { id: 'a', type: 'Note', parent: 'root', order: 1, properties: { title: 'A' } },
    { id: 'b', type: 'Note', parent: 'root', order: 2, properties: { title: 'B' } },
    { id: 'c', type: 'Note', parent: 'a', order: 1, properties: { title: 'C', done: true } },
];

async function loaded() {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    return { api, data };
}

describe('DataController: Undo/Redo', () => {
    it('без действий отменять и повторять нечего', async () => {
        const { data, api } = await loaded();
        expect(data.canUndo()).toBe(false);
        expect(data.canRedo()).toBe(false);
        expect(await data.undo()).toEqual({ ok: false, error: 'Нечего отменять.' });
        expect(await data.redo()).toEqual({ ok: false, error: 'Нечего повторять.' });
        expect(api.changesets).toEqual([]);
    });

    it('отмена изменения свойства отправляет обратный набор и возвращает значение', async () => {
        const { data, api } = await loaded();
        await data.setProperty('a', 'title', 'Новое');
        expect(data.canUndo()).toBe(true);

        const result = await data.undo();

        expect(result).toEqual({ ok: true });
        expect(data.getObject('a')?.properties.title).toBe('A');
        expect(api.changesets[1]).toEqual({
            operations: [{ op: 'update', id: 'a', changes: { title: { old: 'Новое', new: 'A' } } }],
        });
        expect(data.canUndo()).toBe(false);
        expect(data.canRedo()).toBe(true);
    });

    it('повтор применяет изменение снова', async () => {
        const { data, api } = await loaded();
        await data.setProperty('a', 'title', 'Новое');
        await data.undo();

        const result = await data.redo();

        expect(result).toEqual({ ok: true });
        expect(data.getObject('a')?.properties.title).toBe('Новое');
        expect(api.changesets[2]).toEqual(api.changesets[0]);
        expect(data.canUndo()).toBe(true);
        expect(data.canRedo()).toBe(false);
    });

    it('отмена возвращает удалённое значение свойства', async () => {
        const { data } = await loaded();
        await data.setProperty('c', 'done', null);
        await data.undo();
        expect(data.getObject('c')?.properties.done).toBe(true);
    });

    it('отмена перемещения возвращает родителя и порядок', async () => {
        const { data, api } = await loaded();
        await data.move('b', { parent: 'a', order: 7 });

        await data.undo();

        expect(data.getObject('b')).toMatchObject({ parent: 'root', order: 2 });
        expect(api.changesets[1].operations).toEqual([
            {
                op: 'move',
                id: 'b',
                parent: { old: 'a', new: 'root' },
                order: { old: 7, new: 2 },
            },
        ]);
    });

    it('отмена создания удаляет объект, повтор создаёт его с тем же идентификатором', async () => {
        const { data, api } = await loaded();
        const created = await data.create({
            type: 'Note',
            parent: 'root',
            properties: { title: 'N' },
        });
        const id = created.ok ? created.id : '';

        await data.undo();
        expect(data.getObject(id)).toBeUndefined();
        expect(api.changesets[1].operations).toEqual([{ op: 'delete', id }]);

        await data.redo();
        expect(data.getObject(id)?.properties.title).toBe('N');
    });

    it('отмена удаления пересоздаёт поддерево с теми же идентификаторами, значениями и положением', async () => {
        const { data, api } = await loaded();
        await data.remove('a');
        expect(data.getObject('a')).toBeUndefined();
        expect(data.getObject('c')).toBeUndefined();

        const result = await data.undo();

        expect(result).toEqual({ ok: true });
        expect(data.getObject('a')).toEqual(objects[1]);
        expect(data.getObject('c')).toEqual(objects[3]);
        expect(data.getChildren('root').map((o) => o.id)).toEqual(['a', 'b']);
        // Родитель создаётся раньше потомка.
        expect(api.changesets[1].operations.map((o) => `${o.op}:${o.id}`)).toEqual([
            'create:a',
            'create:c',
        ]);
        expect(api.changesets[1].operations[0]).toEqual({
            op: 'create',
            id: 'a',
            type: 'Note',
            parent: 'root',
            order: 1,
            properties: { title: 'A' },
        });
    });

    it('повтор удаления удаляет поддерево снова', async () => {
        const { data } = await loaded();
        await data.remove('a');
        await data.undo();
        await data.redo();
        expect(data.getObject('a')).toBeUndefined();
        expect(data.getObject('c')).toBeUndefined();
    });

    it('отмена идёт в обратном порядке действий', async () => {
        const { data } = await loaded();
        await data.setProperty('a', 'title', 'X');
        await data.setProperty('a', 'title', 'Y');
        await data.undo();
        expect(data.getObject('a')?.properties.title).toBe('X');
        await data.undo();
        expect(data.getObject('a')?.properties.title).toBe('A');
    });

    it('новое действие очищает стек повторов', async () => {
        const { data } = await loaded();
        await data.setProperty('a', 'title', 'X');
        await data.undo();
        expect(data.canRedo()).toBe(true);

        await data.setProperty('b', 'title', 'Z');

        expect(data.canRedo()).toBe(false);
    });

    it('отклонённый набор в стек не попадает', async () => {
        const { data, api } = await loaded();
        api.rejectNext(400, 'нельзя');
        await data.setProperty('a', 'title', 'X');
        expect(data.canUndo()).toBe(false);
    });

    it('конфликт по «было/стало»: стек и модель не меняются, показывается сообщение', async () => {
        const { data, api } = await loaded();
        await data.setProperty('a', 'title', 'X');
        api.rejectNext(409, 'Значение изменено другим пользователем.');

        const result = await data.undo();

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain('Значение изменено другим пользователем.');
        expect(data.getObject('a')?.properties.title).toBe('X');
        expect(data.canUndo()).toBe(true);
        expect(data.canRedo()).toBe(false);
        expect(data.getSnapshot().error).toContain('Значение изменено другим пользователем.');
        expect(data.getSnapshot().needsReload).toBe(false);
        // После конфликта отмену можно повторить.
        expect(await data.undo()).toEqual({ ok: true });
        expect(data.getObject('a')?.properties.title).toBe('A');
    });

    it('конфликт при повторе оставляет стек повторов', async () => {
        const { data, api } = await loaded();
        await data.setProperty('a', 'title', 'X');
        await data.undo();
        api.rejectNext(409, 'конфликт');

        const result = await data.redo();

        expect(result.ok).toBe(false);
        expect(data.canRedo()).toBe(true);
        expect(data.getObject('a')?.properties.title).toBe('A');
    });

    it('перезагрузка данных очищает стеки', async () => {
        const { data } = await loaded();
        await data.setProperty('a', 'title', 'X');
        await data.load();
        expect(data.canUndo()).toBe(false);
    });

    it('подписчики узнают об изменении доступности отмены', async () => {
        const { data } = await loaded();
        let calls = 0;
        data.subscribe(() => calls++);
        await data.setProperty('a', 'title', 'X');
        const before = calls;
        await data.undo();
        expect(calls).toBeGreaterThan(before);
    });
});
