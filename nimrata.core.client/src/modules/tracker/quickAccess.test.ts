import { describe, expect, it } from 'vitest';

import { createDataController } from '@platform';
import type { DataController, TypeDefinition } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureStartStructure, registerTracker } from './tracker';

const types = manifest.types.map((t) => ({
    ...t,
    module: manifest.module,
    moduleVersion: manifest.version,
})) as TypeDefinition[];

const ENTRY = 'QuickAccessEntry';

async function start() {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    registerTracker(data);
    await ensureStartStructure(data);
    const notesRoot = data.getChildren(null).find((o) => o.type === 'NotesRoot')!;
    return { api, data, notesRoot };
}

async function addNote(data: DataController, parent: string, title: string) {
    const before = new Set(data.getChildren(parent).map((o) => o.id));
    const result = await data.runAction(parent, 'createNote', { title });
    expect(result.ok).toBe(true);
    return data.getChildren(parent).find((o) => !before.has(o.id))!;
}

async function addGroup(data: DataController, parent: string, name: string) {
    const before = new Set(data.getChildren(parent).map((o) => o.id));
    const result = await data.runAction(parent, 'createNoteGroup', { name });
    expect(result.ok).toBe(true);
    return data.getChildren(parent).find((o) => !before.has(o.id))!;
}

function entries(data: DataController) {
    return data.getChildren(null).filter((o) => o.type === ENTRY);
}

describe('Трекер: быстрый доступ', () => {
    it('тип записи — механизм, скрытый в дереве, со ссылкой на цель', () => {
        const type = types.find((t) => t.id === ENTRY)!;
        expect(type.automation).toBe(true);
        expect(type.hiddenInTree).toBe(true);
        expect(type.properties?.find((p) => p.id === 'target')?.kind).toBe('reference');
    });

    it('«Добавить» на заметке создаёт запись с названием цели', async () => {
        const { data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Купить молоко');

        const result = await data.runAction(note.id, 'addToQuickAccess');

        expect(result.ok).toBe(true);
        const [entry] = entries(data);
        expect(entries(data)).toHaveLength(1);
        expect(entry.properties.target).toBe(note.id);
        expect(entry.properties.name).toBe('Купить молоко');
    });

    it('«Добавить» на группе заметок создаёт запись с названием группы', async () => {
        const { data, notesRoot } = await start();
        const group = await addGroup(data, notesRoot.id, 'Работа');

        await data.runAction(group.id, 'addToQuickAccess');

        expect(entries(data).map((e) => [e.properties.target, e.properties.name])).toEqual([
            [group.id, 'Работа'],
        ]);
    });

    it('повторное «Добавить» дубля не создаёт', async () => {
        const { data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Одна');
        await data.runAction(note.id, 'addToQuickAccess');

        await data.runAction(note.id, 'addToQuickAccess');

        expect(entries(data)).toHaveLength(1);
    });

    it('«Добавить» доступно, пока записи нет; «Убрать» — только когда она есть', async () => {
        const { data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Одна');
        const ids = () => data.getActions(note.id, 'propertyGrid').map((a) => a.id);
        expect(ids()).toContain('addToQuickAccess');
        expect(ids()).not.toContain('removeFromQuickAccess');

        await data.runAction(note.id, 'addToQuickAccess');

        expect(ids()).not.toContain('addToQuickAccess');
        expect(ids()).toContain('removeFromQuickAccess');
    });

    it('«Убрать» удаляет все записи, ссылающиеся на цель, и не трогает чужие', async () => {
        const { data, notesRoot } = await start();
        const a = await addNote(data, notesRoot.id, 'A');
        const b = await addNote(data, notesRoot.id, 'B');
        await data.runAction(a.id, 'addToQuickAccess');
        await data.runAction(b.id, 'addToQuickAccess');
        // Дубль, пришедший извне (например, из двух вкладок).
        await data.create({
            type: ENTRY,
            parent: null,
            properties: { name: 'A', target: a.id },
        });
        expect(entries(data)).toHaveLength(3);

        const result = await data.runAction(a.id, 'removeFromQuickAccess');

        expect(result.ok).toBe(true);
        expect(entries(data).map((e) => e.properties.target)).toEqual([b.id]);
    });

    it('переименование заметки обновляет название записи', async () => {
        const { data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Старое');
        await data.runAction(note.id, 'addToQuickAccess');

        await data.setProperty(note.id, 'title', 'Новое');

        expect(entries(data)[0].properties.name).toBe('Новое');
    });

    it('смена статуса заметки обновляет название записи вместе с заметкой', async () => {
        const { api, data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Дело');
        await data.runAction(note.id, 'addToQuickAccess');
        const sent = api.changesets.length;

        await data.setProperty(note.id, 'status', 'completed');

        expect(entries(data)[0].properties.name).toBe('[Завершена] Дело');
        expect(api.changesets).toHaveLength(sent + 1);
    });

    it('переименование группы обновляет название записи', async () => {
        const { data, notesRoot } = await start();
        const group = await addGroup(data, notesRoot.id, 'Работа');
        await data.runAction(group.id, 'addToQuickAccess');

        await data.setProperty(group.id, 'name', 'Дом');

        expect(entries(data)[0].properties.name).toBe('Дом');
    });

    it('удаление заметки удаляет её запись в том же наборе изменений', async () => {
        const { api, data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Одна');
        await data.runAction(note.id, 'addToQuickAccess');
        const sent = api.changesets.length;

        const result = await data.remove(note.id);

        expect(result.ok).toBe(true);
        expect(entries(data)).toHaveLength(0);
        expect(api.changesets).toHaveLength(sent + 1);
    });

    it('удаление группы удаляет записи группы и всех вложенных заметок и групп', async () => {
        const { api, data, notesRoot } = await start();
        const group = await addGroup(data, notesRoot.id, 'Внешняя');
        const inner = await addGroup(data, group.id, 'Внутренняя');
        const deep = await addNote(data, inner.id, 'Глубокая');
        const other = await addNote(data, notesRoot.id, 'Остаётся');
        for (const id of [group.id, inner.id, deep.id, other.id]) {
            await data.runAction(id, 'addToQuickAccess');
        }
        expect(entries(data)).toHaveLength(4);
        const sent = api.changesets.length;

        const result = await data.remove(group.id);

        expect(result.ok).toBe(true);
        expect(entries(data).map((e) => e.properties.target)).toEqual([other.id]);
        expect(api.changesets).toHaveLength(sent + 1);
    });

    it('отмена удаления цели возвращает и запись', async () => {
        const { data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Одна');
        await data.runAction(note.id, 'addToQuickAccess');
        await data.remove(note.id);

        const result = await data.undo();

        expect(result.ok).toBe(true);
        expect(entries(data)).toHaveLength(1);
    });
});
