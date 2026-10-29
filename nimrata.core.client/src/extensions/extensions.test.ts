import { describe, expect, it, vi } from 'vitest';

import { createDataController, extensionRegistry } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import notesManifest from './notes/manifest.json';
import tasksManifest from './tasks/manifest.json';

import './index';

import type { TypeDefinition } from '@platform';

const types = [
    ...tasksManifest.types.map((t) => ({ ...t, extension: 'tasks', extensionVersion: 12 })),
    ...notesManifest.types.map((t) => ({ ...t, extension: 'notes', extensionVersion: 12 })),
] as TypeDefinition[];

async function start() {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    const unregisters = extensionRegistry.list().map((e) => e.register(data, {}));
    return { api, data, unregisters };
}

/**
 * Встроенные расширения и их независимость
 */
describe('built-in extensions', () => {
    /**
     * Проверяет, что в реестре зарегистрированы «Трекер задач» и «Трекер заметок»
     */
    it('registry_builtInExtensions_areTasksAndNotes', () => {
        expect(extensionRegistry.list().map((e) => e.id)).toEqual(['tasks', 'notes']);
    });

    /**
     * Проверяет, что манифесты не делят типы между расширениями
     */
    it('manifests_typeIds_doNotOverlap', () => {
        const tasks = new Set(tasksManifest.types.map((t) => t.id));
        const shared = notesManifest.types.map((t) => t.id).filter((id) => tasks.has(id));
        expect(shared).toEqual([]);
    });

    /**
     * Проверяет, что каждое расширение при старте создаёт только свои корни
     */
    it('ensureStart_eachExtension_createsOnlyItsOwnRootsAndSettings', async () => {
        const { data } = await start();
        const [tasks, notes] = extensionRegistry.list();
        const roots = () =>
            data
                .getChildren(null)
                .map((o) => o.type)
                .sort();

        await notes.ensureStart(data);
        expect(roots()).toEqual(['NotesRoot']);

        await tasks.ensureStart(data);
        expect(roots()).toEqual(['NotesRoot', 'SettingsRoot', 'TasksRoot']);
    });

    /**
     * Проверяет, что повторный ensureStart всех расширений ничего не дублирует и не отправляет
     */
    it('ensureStart_calledTwiceForAllExtensions_createsNoDuplicatesAndSendsNothing', async () => {
        const { api, data } = await start();
        for (const extension of extensionRegistry.list()) await extension.ensureStart(data);
        const sent = api.changesets.length;
        const roots = data.getChildren(null).length;

        for (const extension of extensionRegistry.list()) {
            expect((await extension.ensureStart(data)).ok).toBe(true);
        }

        expect(api.changesets).toHaveLength(sent);
        expect(data.getChildren(null)).toHaveLength(roots);
    });

    /**
     * Проверяет, что отписка расширения снимает его действия и не затрагивает другое
     */
    it('register_unregisterOneExtension_keepsActionsOfTheOther', async () => {
        const { data, unregisters } = await start();
        for (const extension of extensionRegistry.list()) await extension.ensureStart(data);
        const notesRoot = data
            .getChildren(data.getChildren(null).find((o) => o.type === 'NotesRoot')!.id)
            .find((o) => o.type === 'ActiveNotesRoot')!;
        const current = data
            .getChildren(data.getChildren(null).find((o) => o.type === 'TasksRoot')!.id)
            .find((o) => o.type === 'CurrentTasksRoot')!;

        unregisters[0](); // tasks

        expect((await data.runAction(current.id, 'createTask', { name: 'А' })).ok).toBe(false);
        expect((await data.runAction(notesRoot.id, 'createNote', { name: 'Б' })).ok).toBe(true);
    });
});

/**
 * Данные отключённого расширения для остальных расширений
 */
describe('hidden extension data', () => {
    /**
     * Проверяет, что ссылка задачи на заметку отключённого «Трекера заметок» ведёт себя как ссылка
     * на отсутствующий объект, а после подключения снова работает
     */
    it('internalLink_targetInDisconnectedExtension_actsAsMissingObject', async () => {
        const reveal = vi.fn();
        const api = createFakeApi(
            types,
            [
                { id: 't', type: 'TasksRoot', parent: null, number: 0, properties: {} },
                { id: 'c', type: 'CurrentTasksRoot', parent: 't', number: 0, properties: {} },
                { id: 'n', type: 'NotesRoot', parent: null, number: 1, properties: {} },
                {
                    id: 'k',
                    type: 'Task',
                    parent: 'c',
                    number: 0,
                    properties: { name: 'А', internalLink: 'n' },
                },
            ],
            {
                extensions: [
                    { id: 'tasks', connected: true },
                    { id: 'notes', connected: false },
                ],
            },
        );
        const data = createDataController({ api });
        extensionRegistry.list().forEach((e) => e.register(data, { reveal }));
        await data.load();

        const hidden = await data.runAction('k', 'openInternalLink');
        await api.put('extensions/notes/connection', { connected: true });
        await data.load();
        const visible = await data.runAction('k', 'openInternalLink');

        expect(hidden).toMatchObject({ ok: false, error: 'Объект по ссылке недоступен.' });
        expect(visible.ok).toBe(true);
        expect(reveal).toHaveBeenCalledWith('n');
    });
});
