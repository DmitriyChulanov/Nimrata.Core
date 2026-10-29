import { describe, expect, it, vi } from 'vitest';

import { CUSTOM_COMMAND, createDataController, readCustomParams } from '@platform';
import { createFakeApi, whenSynced } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureNotesStart, registerNotes } from './notesExtension';

import type { CommandDefinition, DataController, TypeDefinition } from '@platform';

const customCommandType = {
    id: CUSTOM_COMMAND,
    name: 'Пользовательская команда',
    hiddenInTree: true,
    properties: [
        { id: 'name', name: 'Название', kind: 'string' },
        { id: 'extension', name: 'Расширение', kind: 'string' },
        { id: 'command', name: 'Команда', kind: 'string' },
        { id: 'params', name: 'Параметры', kind: 'text' },
    ],
};

const types = [
    customCommandType,
    ...manifest.types.map((t) => ({
        ...t,
        extension: manifest.extension,
        extensionVersion: manifest.version,
    })),
] as TypeDefinition[];

const CREATE = 'createQuickAccessCommand';
const REMOVE = 'removeQuickAccessCommand';

async function start(reveal?: (id: string) => void) {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    registerNotes(data, { reveal });
    await ensureNotesStart(data);
    const root = data.getChildren(null).find((o) => o.type === 'NotesRoot')!;
    const notesRoot = data.getChildren(root.id).find((o) => o.type === 'ActiveNotesRoot')!;
    return { api, data, notesRoot };
}

async function addNote(data: DataController, parent: string, title: string) {
    const before = new Set(data.getChildren(parent).map((o) => o.id));
    const result = await data.runAction(parent, 'createNote', { name: title });
    expect(result.ok).toBe(true);
    return data.getChildren(parent).find((o) => !before.has(o.id))!;
}

async function addGroup(data: DataController, parent: string, name: string) {
    const before = new Set(data.getChildren(parent).map((o) => o.id));
    const result = await data.runAction(parent, 'createNoteGroup', { name });
    expect(result.ok).toBe(true);
    return data.getChildren(parent).find((o) => !before.has(o.id))!;
}

function commands(data: DataController) {
    return data.getChildren(null).filter((o) => o.type === CUSTOM_COMMAND);
}

const openInTree = manifest.commands[0] as CommandDefinition;

/**
 * Быстрый доступ Трекера заметок: пользовательские команды «Открыть в дереве»
 */
describe('Notes: quick access commands', () => {
    /**
     * Проверяет, что манифест описывает команду-шаблон со ссылкой на цель
     */
    it('quickAccess_manifest_declaresTemplateCommandWithTargetReference', () => {
        expect(openInTree.id).toBe('openInTree');
        expect(openInTree.template).toBe(true);
        expect(openInTree.parameters?.find((p) => p.id === 'target')?.kind).toBe('reference');
        expect(types.some((t) => t.id === 'QuickAccessEntry')).toBe(false);
    });

    /**
     * Проверяет, что действие у заметки создаёт команду с названием цели и ссылкой в параметрах
     */
    it('quickAccess_createOnNote_createsCommandNamedAfterTarget', async () => {
        const { data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Купить молоко');

        const result = await data.runAction(note.id, CREATE);

        expect(result.ok).toBe(true);
        const [command] = commands(data);
        expect(commands(data)).toHaveLength(1);
        expect(command.properties.name).toBe('Купить молоко');
        expect(command.properties.extension).toBe('notes');
        expect(command.properties.command).toBe('openInTree');
        expect(readCustomParams(command)).toEqual({ target: note.id });
    });

    /**
     * Проверяет, что действие у группы заметок создаёт команду с названием группы
     */
    it('quickAccess_createOnNoteGroup_createsCommandNamedAfterGroup', async () => {
        const { data, notesRoot } = await start();
        const group = await addGroup(data, notesRoot.id, 'Работа');

        await data.runAction(group.id, CREATE);

        expect(commands(data).map((c) => [c.properties.name, readCustomParams(c).target])).toEqual([
            ['Работа', group.id],
        ]);
    });

    /**
     * Проверяет, что повторное создание не даёт дубля
     */
    it('quickAccess_createAgain_createsNoDuplicate', async () => {
        const { data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Одна');
        await data.runAction(note.id, CREATE);

        await data.runAction(note.id, CREATE);

        expect(commands(data)).toHaveLength(1);
    });

    /**
     * Проверяет, что «Создать» доступно, пока команды нет, а «Удалить» — только когда она есть
     */
    it('quickAccess_actionsAvailability_followsCommandPresence', async () => {
        const { data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Одна');
        const ids = () => data.getActions(note.id, 'propertyGrid').map((a) => a.id);
        expect(ids()).toContain(CREATE);
        expect(ids()).not.toContain(REMOVE);

        await data.runAction(note.id, CREATE);

        expect(ids()).not.toContain(CREATE);
        expect(ids()).toContain(REMOVE);
    });

    /**
     * Проверяет, что «Удалить» убирает команды цели и не трогает остальные
     */
    it('quickAccess_remove_deletesCommandsOfTargetAndLeavesOthers', async () => {
        const { data, notesRoot } = await start();
        const a = await addNote(data, notesRoot.id, 'A');
        const b = await addNote(data, notesRoot.id, 'B');
        await data.runAction(a.id, CREATE);
        await data.runAction(b.id, CREATE);

        const result = await data.runAction(a.id, REMOVE);

        expect(result.ok).toBe(true);
        expect(commands(data).map((c) => readCustomParams(c).target)).toEqual([b.id]);
    });

    /**
     * Проверяет, что команда «Открыть в дереве» показывает цель в дереве
     */
    it('quickAccess_openInTreeCommand_revealsTarget', async () => {
        const reveal = vi.fn();
        const { data, notesRoot } = await start(reveal);
        const note = await addNote(data, notesRoot.id, 'Одна');

        const result = await data.runCommand(openInTree, { target: note.id });

        expect(result.ok).toBe(true);
        expect(reveal).toHaveBeenCalledWith(note.id);
    });

    /**
     * Проверяет, что команда отказывает, если цели уже нет
     */
    it('quickAccess_openInTreeCommand_missingTarget_fails', async () => {
        const reveal = vi.fn();
        const { data } = await start(reveal);

        const result = await data.runCommand(openInTree, { target: 'нет-такого' });

        expect(result.ok).toBe(false);
        expect(reveal).not.toHaveBeenCalled();
    });

    /**
     * Проверяет, что переименование заметки обновляет название команды
     */
    it('quickAccess_noteRenamed_updatesCommandName', async () => {
        const { data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Старое');
        await data.runAction(note.id, CREATE);

        await data.setProperty(note.id, 'name', 'Новое');

        expect(commands(data)[0].properties.name).toBe('Новое');
    });

    /**
     * Проверяет, что переименование группы обновляет название команды
     */
    it('quickAccess_groupRenamed_updatesCommandName', async () => {
        const { data, notesRoot } = await start();
        const group = await addGroup(data, notesRoot.id, 'Работа');
        await data.runAction(group.id, CREATE);

        await data.setProperty(group.id, 'name', 'Дом');

        expect(commands(data)[0].properties.name).toBe('Дом');
    });

    /**
     * Проверяет, что удаление заметки удаляет её команду в том же наборе изменений
     */
    it('quickAccess_noteDeleted_deletesItsCommandInSameChangeset', async () => {
        const { api, data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Одна');
        await data.runAction(note.id, CREATE);
        await whenSynced(data);
        const sent = api.changesets.length;

        const result = await data.remove(note.id);

        expect(result.ok).toBe(true);
        expect(commands(data)).toHaveLength(0);
        await whenSynced(data);
        expect(api.changesets).toHaveLength(sent + 1);
    });

    /**
     * Проверяет, что удаление группы удаляет команды группы и всех вложенных заметок и групп
     */
    it('quickAccess_groupDeleted_deletesCommandsOfWholeSubtree', async () => {
        const { api, data, notesRoot } = await start();
        const group = await addGroup(data, notesRoot.id, 'Внешняя');
        const inner = await addGroup(data, group.id, 'Внутренняя');
        const deep = await addNote(data, inner.id, 'Глубокая');
        const other = await addNote(data, notesRoot.id, 'Остаётся');
        for (const id of [group.id, inner.id, deep.id, other.id]) {
            await data.runAction(id, CREATE);
        }
        await whenSynced(data);
        const sent = api.changesets.length;

        const result = await data.remove(group.id);

        expect(result.ok).toBe(true);
        expect(commands(data).map((c) => readCustomParams(c).target)).toEqual([other.id]);
        await whenSynced(data);
        expect(api.changesets).toHaveLength(sent + 1);
    });

    /**
     * Проверяет, что отмена удаления цели возвращает и команду
     */
    it('quickAccess_undoTargetDeletion_restoresCommandToo', async () => {
        const { data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Одна');
        await data.runAction(note.id, CREATE);
        await data.remove(note.id);

        const result = await data.undo();

        expect(result.ok).toBe(true);
        expect(commands(data)).toHaveLength(1);
    });

    /**
     * Проверяет, что завершение заметки не ломает её команду: цель та же
     */
    it('quickAccess_noteCompleted_keepsCommandTargetingNote', async () => {
        const { data, notesRoot } = await start();
        const note = await addNote(data, notesRoot.id, 'Идея');
        await data.runAction(note.id, CREATE);

        await data.runAction(note.id, 'complete');

        expect(readCustomParams(commands(data)[0]).target).toBe(note.id);
    });
});
