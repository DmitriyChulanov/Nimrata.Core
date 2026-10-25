import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureStartStructure, registerTracker } from './tracker';

import type { DataController, TypeDefinition } from '@platform';
import type { FakeApi } from '@platform/data/fakeApi';

const types = manifest.types.map((t) => ({
    ...t,
    module: manifest.module,
    moduleVersion: manifest.version,
})) as TypeDefinition[];

async function start(objects: unknown[] = []) {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    registerTracker(data);
    return { api, data };
}

function byType(data: DataController, type: string) {
    return data.getChildren(null).find((o) => o.type === type)!;
}

describe('Tracker: start structure', () => {
    it('startStructure_noRoots_createsTasksWithTwoSubgroupsAndNotesInOneChangeset', async () => {
        const { api, data } = await start();

        const result = await ensureStartStructure(data);

        expect(result.ok).toBe(true);
        expect(api.changesets).toHaveLength(1);
        expect(
            data
                .getChildren(null)
                .map((o) => o.type)
                .sort(),
        ).toEqual(['NotesRoot', 'SelectTodayMechanism', 'TasksRoot']);
        const tasks = byType(data, 'TasksRoot');
        expect(data.getChildren(tasks.id).map((o) => o.type)).toEqual([
            'CurrentTasksRoot',
            'CompletedTasksRoot',
        ]);
        expect(data.getChildren(byType(data, 'NotesRoot').id)).toEqual([]);
    });

    it('startStructure_repeatedLogin_createsNoDuplicatesAndSendsNothing', async () => {
        const { api, data } = await start();
        await ensureStartStructure(data);
        // Повторный вход: модель загружается заново из того, что принял сервер
        api.objects = [
            ...data.getChildren(null),
            ...data.getChildren(byType(data, 'TasksRoot').id),
        ];
        await data.load();

        const result = await ensureStartStructure(data);

        expect(result.ok).toBe(true);
        expect(api.changesets).toHaveLength(1);
        expect(data.getChildren(null)).toHaveLength(3);
    });

    it('startStructure_serverRejects_returnsReasonAndLeavesNoPartialStructure', async () => {
        const { api, data } = await start();
        api.rejectNext(400, 'нельзя');

        const result = await ensureStartStructure(data);

        expect(result).toEqual({ ok: false, error: 'нельзя' });
        expect(data.getChildren(null)).toEqual([]);
    });

    it('startStructure_dataNotLoaded_createsNothingToAvoidDuplicatesOnNetworkFailure', async () => {
        const api = createFakeApi(types, []);
        api.get = () => Promise.reject(new Error('сеть недоступна'));
        const data = createDataController({ api });
        await data.load();

        const result = await ensureStartStructure(data);

        expect(result.ok).toBe(false);
        expect(api.changesets).toHaveLength(0);
    });
});

describe('Tracker: notes', () => {
    let api: FakeApi;
    let data: DataController;
    let notesId: string;

    beforeEach(async () => {
        ({ api, data } = await start());
        await ensureStartStructure(data);
        notesId = byType(data, 'NotesRoot').id;
    });

    function childByName(parent: string, name: string) {
        return data.getChildren(parent).find((o) => o.properties.name === name);
    }

    it('createNote_action_createsNoteWithEnteredTitleUnderRoot', async () => {
        const result = await data.runAction(notesId, 'createNote', { title: 'Идея' });

        expect(result.ok).toBe(true);
        const note = childByName(notesId, 'Идея')!;
        expect(note.type).toBe('Note');
        expect(note.properties.title).toBe('Идея');
    });

    it('createNoteGroup_action_createsGroupWithNestedGroupsAndNotes', async () => {
        await data.runAction(notesId, 'createNoteGroup', { name: 'Работа' });
        const group = childByName(notesId, 'Работа')!;
        expect(group.type).toBe('NoteGroup');

        await data.runAction(group.id, 'createNoteGroup', { name: 'Проект' });
        const inner = childByName(group.id, 'Проект')!;
        await data.runAction(inner.id, 'createNote', { title: 'Заметка' });

        expect(inner.type).toBe('NoteGroup');
        expect(childByName(inner.id, 'Заметка')?.type).toBe('Note');
    });

    it('createNote_withoutTitle_isRejected', async () => {
        const result = await data.runAction(notesId, 'createNote', { title: '' });

        expect(result.ok).toBe(false);
        expect(data.getChildren(notesId)).toEqual([]);
    });

    it('noteName_withoutStatus_equalsTitle', async () => {
        await data.runAction(notesId, 'createNote', { title: 'Идея' });

        expect(data.getChildren(notesId)[0].properties.name).toBe('Идея');
    });

    it('noteName_withStatus_isStatusInBracketsTitleAndUpdatesOnStatusAndTitleChange', async () => {
        await data.runAction(notesId, 'createNote', { title: 'Идея' });
        const id = data.getChildren(notesId)[0].id;

        await data.setProperty(id, 'status', 'completed');
        expect(data.getObject(id)?.properties.name).toBe('[Завершена] Идея');

        await data.setProperty(id, 'title', 'Мысль');
        expect(data.getObject(id)?.properties.name).toBe('[Завершена] Мысль');

        await data.setProperty(id, 'status', null);
        expect(data.getObject(id)?.properties.name).toBe('Мысль');
    });

    it('noteStatus_changeAndNameRecompute_areOneChangesetAndUndoRevertsBoth', async () => {
        await data.runAction(notesId, 'createNote', { title: 'Идея' });
        const id = data.getChildren(notesId)[0].id;
        const before = api.changesets.length;

        await data.setProperty(id, 'status', 'completed');
        expect(api.changesets).toHaveLength(before + 1);

        await data.undo();
        expect(data.getObject(id)?.properties.status).toBeUndefined();
        expect(data.getObject(id)?.properties.name).toBe('Идея');
    });

    it('noteName_createdFromTreeWithTitle_getsNameToo', async () => {
        const created = await data.create({
            type: 'Note',
            parent: notesId,
            properties: { title: 'Из дерева', status: 'completed' },
        });

        expect(created.ok).toBe(true);
        const id = (created as { id: string }).id;
        expect(data.getObject(id)?.properties.name).toBe('[Завершена] Из дерева');
    });

    it('noteColorRules_mediumPriorityOrangeHighRedCompletedGreen', () => {
        expect(data.getType('Note')?.colorRules).toEqual([
            { property: 'priority', equals: 'medium', color: 'orange' },
            { property: 'priority', equals: 'high', color: 'red' },
            { property: 'status', equals: 'completed', color: 'green' },
        ]);
    });

    describe('"Open external link"', () => {
        it('openExternalLink_available_onlyWhenLinkIsSet', async () => {
            await data.runAction(notesId, 'createNote', { title: 'Без ссылки' });
            await data.runAction(notesId, 'createNote', { title: 'Со ссылкой' });
            const without = childByName(notesId, 'Без ссылки')!;
            const withLink = childByName(notesId, 'Со ссылкой')!;
            await data.setProperty(withLink.id, 'link', 'https://example.test/a');

            const ids = (id: string) => data.getActions(id, 'propertyGrid').map((a) => a.id);
            expect(ids(without.id)).not.toContain('openExternalLink');
            expect(ids(withLink.id)).toContain('openExternalLink');
        });

        it('openExternalLink_opensLinkInNewTabWithoutOpener', async () => {
            const open = vi.spyOn(window, 'open').mockReturnValue(null);
            await data.runAction(notesId, 'createNote', { title: 'Со ссылкой' });
            const id = data.getChildren(notesId)[0].id;
            await data.setProperty(id, 'link', 'https://example.test/a');

            const result = await data.runAction(id, 'openExternalLink');

            expect(result.ok).toBe(true);
            expect(open).toHaveBeenCalledWith(
                'https://example.test/a',
                '_blank',
                'noopener,noreferrer',
            );
            open.mockRestore();
        });

        it('openExternalLink_unsafeSchemes_javascriptAreNotOpened', async () => {
            const open = vi.spyOn(window, 'open').mockReturnValue(null);
            await data.runAction(notesId, 'createNote', { title: 'Плохая' });
            const id = data.getChildren(notesId)[0].id;
            await data.setProperty(id, 'link', 'javascript:alert(1)');

            const result = await data.runAction(id, 'openExternalLink');

            expect(result.ok).toBe(false);
            expect(open).not.toHaveBeenCalled();
            open.mockRestore();
        });
    });
});

describe('Tracker: user isolation', () => {
    it('isolation_structure_isCompletedFromObjectsServerGaveThisUser', async () => {
        // Сервер отдаёт пользователю только его объекты; у второго пользователя корней нет —
        // они создаются у него, а чужие объекты не появляются
        const own = [{ id: 'r1', type: 'NotesRoot', parent: null, order: 0, properties: {} }];
        const first = await start(own);
        const second = await start([]);

        await ensureStartStructure(first.data);
        await ensureStartStructure(second.data);

        // Первому недостаёт только «Задач»; «Заметки» у него уже есть и не дублируются
        expect(first.data.getChildren(null).filter((o) => o.type === 'NotesRoot')).toHaveLength(1);
        expect(first.data.getObject('r1')).toBeDefined();
        expect(second.data.getObject('r1')).toBeUndefined();
        expect(second.data.getChildren(null)).toHaveLength(3);
    });
});

describe('Tracker manifest: consistency with logic', () => {
    it('manifest_everyNodeType_hasIcon', () => {
        const withoutIcon = manifest.types.filter((t) => !('icon' in t) || !t.icon);
        expect(withoutIcon.map((t) => t.id)).toEqual([]);
    });

    it('manifest_startStructure_isAcceptedAsServerWouldAcceptIt', async () => {
        const { api, data } = await start([]);

        const result = await ensureStartStructure(data);

        expect(result.ok).toBe(true);
        expect(api.changesets).toHaveLength(1);
        const created = (api.changesets[0].operations as { type: string }[]).map((o) => o.type);
        expect(created).toContain('CurrentTasksRoot');
        expect(created).toContain('CompletedTasksRoot');
    });
});
