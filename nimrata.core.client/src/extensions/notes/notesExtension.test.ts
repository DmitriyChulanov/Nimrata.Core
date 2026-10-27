import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataController, ICON_REGISTRY } from '@platform';
import { PALETTE_COLORS } from '@platform/tree/colorRules';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureNotesStart, registerNotes } from './notesExtension';

import type { DataController, TypeDefinition } from '@platform';
import type { FakeApi } from '@platform/data/fakeApi';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

async function start(objects: unknown[] = []) {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    registerNotes(data);
    return { api, data };
}

function byType(data: DataController, type: string) {
    return data.getChildren(null).find((o) => o.type === type)!;
}

/**
 * Стартовая структура Трекера заметок
 */
describe('Notes: start structure', () => {
    /**
     * Проверяет, что без корней создаются корень заметок с «Активными» и «Завершёнными» одним набором
     */
    it('startStructure_noRoots_createsNotesRootWithActiveAndCompletedInOneChangeset', async () => {
        const { api, data } = await start();

        const result = await ensureNotesStart(data);

        expect(result.ok).toBe(true);
        expect(api.changesets).toHaveLength(1);
        expect(data.getChildren(null).map((o) => o.type)).toEqual(['NotesRoot']);
        expect(data.getChildren(byType(data, 'NotesRoot').id).map((o) => o.type)).toEqual([
            'ActiveNotesRoot',
            'CompletedNotesRoot',
        ]);
    });

    /**
     * Проверяет, что у существующего корня заметок недостающие «Активные» и «Завершённые» достраиваются
     */
    it('startStructure_notesRootWithoutChildren_createsMissingRoots', async () => {
        const { api, data } = await start([
            { id: 'n', type: 'NotesRoot', parent: null, order: 0, properties: {} },
        ]);

        const result = await ensureNotesStart(data);

        expect(result.ok).toBe(true);
        expect(api.changesets).toHaveLength(1);
        expect(data.getChildren('n').map((o) => o.type)).toEqual([
            'ActiveNotesRoot',
            'CompletedNotesRoot',
        ]);
    });

    /**
     * Проверяет, что повторный вызов без перезагрузки и после неё не создаёт дублей и ничего не отправляет
     */
    it('startStructure_calledTwice_createsNoDuplicatesAndSendsNothing', async () => {
        const { api, data } = await start();
        await ensureNotesStart(data);

        const again = await ensureNotesStart(data);
        const notesRoot = byType(data, 'NotesRoot');
        api.objects = [notesRoot, ...data.getChildren(notesRoot.id)];
        await data.load();
        const afterReload = await ensureNotesStart(data);

        expect(again.ok && afterReload.ok).toBe(true);
        expect(api.changesets).toHaveLength(1);
        expect(data.getChildren(null)).toHaveLength(1);
        expect(data.getChildren(notesRoot.id)).toHaveLength(2);
    });

    /**
     * Проверяет, что при отказе сервера возвращается причина и ничего не создаётся
     */
    it('startStructure_serverRejects_returnsReasonAndCreatesNothing', async () => {
        const { api, data } = await start();
        api.rejectNext(400, 'нельзя');

        const result = await ensureNotesStart(data);

        expect(result).toMatchObject({ ok: false, error: 'нельзя' });
        expect(data.getChildren(null)).toEqual([]);
    });
});

/**
 * Гонка при создании корня заметок
 */
describe('Notes: start structure under race', () => {
    /**
     * Проверяет, что отказ singleton_exists (корень уже создан где-то ещё) считается «уже есть»
     */
    it('startStructure_singletonExists_isAlreadyThereNotError', async () => {
        const { api, data } = await start();
        // сервер уже содержит корень, клиент о нём не знает
        api.objects = [{ id: 'n', type: 'NotesRoot', parent: null, order: 0, properties: {} }];

        const result = await ensureNotesStart(data);

        expect(result.ok).toBe(true);
        expect(api.changesets).toHaveLength(0);
        expect(data.getChildren(null).map((o) => o.id)).toEqual(['n']);
    });

    /**
     * Проверяет, что 409 без кода перезагружает данные и повторяет создание один раз
     */
    it('startStructure_conflictWithoutCode_reloadsAndRetriesOnce', async () => {
        const { api, data } = await start();
        api.rejectNext(409, 'расхождение');

        const result = await ensureNotesStart(data);

        expect(result.ok).toBe(true);
        expect(api.changesets).toHaveLength(1);
        expect(data.getChildren(null).map((o) => o.type)).toEqual(['NotesRoot']);
    });
});

/**
 * Заметки Трекера заметок
 */
describe('Notes: behavior', () => {
    let api: FakeApi;
    let data: DataController;
    let notesId: string;
    let completedId: string;

    beforeEach(async () => {
        ({ api, data } = await start());
        await ensureNotesStart(data);
        const root = byType(data, 'NotesRoot').id;
        notesId = data.getChildren(root).find((o) => o.type === 'ActiveNotesRoot')!.id;
        completedId = data.getChildren(root).find((o) => o.type === 'CompletedNotesRoot')!.id;
    });

    function childByName(parent: string, name: string) {
        return data.getChildren(parent).find((o) => o.properties.name === name);
    }

    function actionIds(id: string) {
        return data.getActions(id, 'contextMenu').map((a) => a.id);
    }

    /**
     * Проверяет, что действие создаёт заметку с введённым названием в «Активных»
     */
    it('createNote_action_createsNoteWithEnteredTitleUnderActive', async () => {
        const result = await data.runAction(notesId, 'createNote', { title: 'Идея' });

        expect(result.ok).toBe(true);
        const note = childByName(notesId, 'Идея')!;
        expect(note.type).toBe('Note');
        expect(note.properties.title).toBe('Идея');
    });

    /**
     * Проверяет, что создание заметки и группы доступно в «Активных» и недоступно у корня заметок и «Завершённых»
     */
    it('createActions_availableOnlyInActive', () => {
        const root = byType(data, 'NotesRoot').id;

        expect(actionIds(root)).not.toContain('createNote');
        expect(actionIds(completedId)).not.toContain('createNote');
        expect(actionIds(completedId)).not.toContain('createNoteGroup');
        expect(actionIds(notesId)).toEqual(
            expect.arrayContaining(['createNote', 'createNoteGroup']),
        );
    });

    /**
     * Проверяет, что в группе из «Завершённых» создание недоступно, а в активной группе доступно
     */
    it('createActions_inGroup_availableOnlyInActiveBranch', async () => {
        await data.runAction(notesId, 'createNoteGroup', { name: 'Работа' });
        const active = childByName(notesId, 'Работа')!;
        const archived = await data.create({
            type: 'NoteGroup',
            parent: completedId,
            properties: { name: 'Работа' },
        });
        const archivedId = (archived as { id: string }).id;

        expect(actionIds(active.id)).toContain('createNote');
        expect(actionIds(archivedId)).not.toContain('createNote');
        expect(actionIds(archivedId)).not.toContain('createNoteGroup');
    });

    /**
     * Проверяет, что действие создаёт группу, в которой можно создавать вложенные группы и заметки
     */
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

    /**
     * Проверяет, что заметка без названия отклоняется
     */
    it('createNote_withoutTitle_isRejected', async () => {
        const result = await data.runAction(notesId, 'createNote', { title: '' });

        expect(result.ok).toBe(false);
        expect(data.getChildren(notesId)).toEqual([]);
    });

    /**
     * Проверяет, что имя заметки равно названию и следует за его изменением
     */
    it('noteName_equalsTitleAndFollowsRename', async () => {
        await data.runAction(notesId, 'createNote', { title: 'Идея' });
        const id = data.getChildren(notesId)[0].id;
        expect(data.getObject(id)?.properties.name).toBe('Идея');

        await data.setProperty(id, 'title', 'Мысль');

        expect(data.getObject(id)?.properties.name).toBe('Мысль');
    });

    /**
     * Проверяет, что заметка, созданная из дерева с названием, получает и имя
     */
    it('noteName_createdFromTreeWithTitle_getsNameToo', async () => {
        const created = await data.create({
            type: 'Note',
            parent: notesId,
            properties: { title: 'Из дерева' },
        });

        expect(created.ok).toBe(true);
        const id = (created as { id: string }).id;
        expect(data.getObject(id)?.properties.name).toBe('Из дерева');
    });

    /**
     * Проверяет, что статуса у заметки нет, а цвет задаёт только приоритет
     */
    it('noteType_hasNoStatusAndColorRulesOnlyByPriority', () => {
        const note = data.getType('Note');

        expect(note?.properties?.some((p) => p.id === 'status')).toBe(false);
        expect(note?.colorRules).toEqual([
            { property: 'priority', equals: 'medium', color: 'orange' },
            { property: 'priority', equals: 'high', color: 'red' },
        ]);
    });

    /**
     * Действие «Завершить»
     */
    describe('"Complete"', () => {
        async function group(parent: string, name: string) {
            await data.runAction(parent, 'createNoteGroup', { name });
            return childByName(parent, name)!;
        }

        /**
         * Проверяет, что заметка прямо в «Активных» переносится прямо в «Завершённые»
         */
        it('complete_noteDirectlyUnderActive_movesDirectlyUnderCompleted', async () => {
            await data.runAction(notesId, 'createNote', { title: 'Идея' });
            const note = childByName(notesId, 'Идея')!;

            const result = await data.runAction(note.id, 'complete');

            expect(result.ok).toBe(true);
            expect(data.getObject(note.id)?.parent).toBe(completedId);
            expect(data.getChildren(notesId)).toEqual([]);
        });

        /**
         * Проверяет, что цепочка вложенных групп воспроизводится в «Завершённых», пустая группа остаётся
         */
        it('complete_noteInNestedGroups_recreatesChainAndLeavesEmptyGroupsInActive', async () => {
            const work = await group(notesId, 'Работа');
            const project = await group(work.id, 'Проект');
            await data.runAction(project.id, 'createNote', { title: 'Идея' });
            const note = childByName(project.id, 'Идея')!;

            const result = await data.runAction(note.id, 'complete');

            expect(result.ok).toBe(true);
            const archivedWork = childByName(completedId, 'Работа')!;
            expect(archivedWork.type).toBe('NoteGroup');
            const archivedProject = childByName(archivedWork.id, 'Проект')!;
            expect(data.getObject(note.id)?.parent).toBe(archivedProject.id);
            expect(data.getObject(work.id)).toBeDefined();
            expect(data.getObject(project.id)).toBeDefined();
            expect(data.getChildren(project.id)).toEqual([]);
        });

        /**
         * Проверяет, что существующая группа в «Завершённых» переиспользуется, а недостающая создаётся
         */
        it('complete_existingGroupInCompleted_isReusedAndMissingIsCreated', async () => {
            const work = await group(notesId, 'Работа');
            const project = await group(work.id, 'Проект');
            await data.runAction(work.id, 'createNote', { title: 'Первая' });
            await data.runAction(project.id, 'createNote', { title: 'Вторая' });
            await data.runAction(childByName(work.id, 'Первая')!.id, 'complete');
            const archivedWork = childByName(completedId, 'Работа')!;

            await data.runAction(childByName(project.id, 'Вторая')!.id, 'complete');

            expect(data.getChildren(completedId)).toHaveLength(1);
            const names = data.getChildren(archivedWork.id).map((o) => o.properties.name);
            expect(names.sort()).toEqual(['Первая', 'Проект']);
            const archivedProject = childByName(archivedWork.id, 'Проект')!;
            expect(data.getChildren(archivedProject.id).map((o) => o.properties.name)).toEqual([
                'Вторая',
            ]);
        });

        /**
         * Проверяет, что перенос и создание групп идут одним набором изменений, отмена возвращает всё
         */
        it('complete_isOneChangesetAndUndoRestoresNoteAndRemovesCreatedGroups', async () => {
            const work = await group(notesId, 'Работа');
            await data.runAction(work.id, 'createNote', { title: 'Идея' });
            const note = childByName(work.id, 'Идея')!;
            const before = api.changesets.length;

            await data.runAction(note.id, 'complete');
            expect(api.changesets).toHaveLength(before + 1);

            await data.undo();
            expect(data.getObject(note.id)?.parent).toBe(work.id);
            expect(data.getChildren(completedId)).toEqual([]);
        });

        /**
         * Проверяет, что «Завершить» доступно только у заметки в «Активных»
         */
        it('complete_available_onlyForNoteInActive', async () => {
            await data.runAction(notesId, 'createNote', { title: 'Идея' });
            const note = childByName(notesId, 'Идея')!;
            expect(actionIds(note.id)).toContain('complete');

            await data.runAction(note.id, 'complete');

            expect(actionIds(note.id)).not.toContain('complete');
        });

        /**
         * Проверяет, что запись быстрого доступа заметки переживает завершение
         */
        it('complete_noteWithQuickAccess_keepsEntryTargetingNote', async () => {
            await data.runAction(notesId, 'createNote', { title: 'Идея' });
            const note = childByName(notesId, 'Идея')!;
            await data.runAction(note.id, 'addToQuickAccess');

            await data.runAction(note.id, 'complete');

            const entry = data.getChildren(null).find((o) => o.type === 'QuickAccessEntry')!;
            expect(entry.properties.target).toBe(note.id);
        });
    });

    /**
     * Действие «Открыть внешнюю ссылку»
     */
    describe('"Open external link"', () => {
        /**
         * Проверяет, что действие доступно только при заданной ссылке
         */
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

        /**
         * Проверяет, что ссылка открывается в новой вкладке без доступа к открывшей странице
         */
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

        /**
         * Проверяет, что небезопасные схемы, например javascript, не открываются
         */
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

/**
 * Изоляция пользователей в Трекере заметок
 */
describe('Notes: user isolation', () => {
    /**
     * Проверяет, что корень достраивается по объектам, которые сервер отдал этому пользователю
     */
    it('isolation_root_isCreatedFromObjectsServerGaveThisUser', async () => {
        const own = [{ id: 'r1', type: 'NotesRoot', parent: null, order: 0, properties: {} }];
        const first = await start(own);
        const second = await start([]);

        await ensureNotesStart(first.data);
        await ensureNotesStart(second.data);

        expect(first.data.getChildren(null)).toHaveLength(1);
        expect(first.data.getObject('r1')).toBeDefined();
        expect(second.data.getObject('r1')).toBeUndefined();
        expect(second.data.getChildren(null)).toHaveLength(1);
    });
});

/**
 * Согласованность манифеста Трекера заметок с логикой
 */
describe('Notes manifest: consistency with logic', () => {
    /**
     * Проверяет, что значок каждого типа узла есть в реестре иконок
     */
    it('manifest_everyNodeTypeIcon_existsInRegistry', () => {
        const unknown = manifest.types.filter((t) => !Object.hasOwn(ICON_REGISTRY, t.icon));
        expect(unknown.map((t) => t.id)).toEqual([]);
    });

    /**
     * Проверяет, что цвет значка каждого типа узла — имя палитры
     */
    it('manifest_everyNodeTypeIconColor_isPaletteColor', () => {
        const invalid = manifest.types.filter((t) => !PALETTE_COLORS.has(t.iconColor));
        expect(invalid.map((t) => t.id)).toEqual([]);
    });

    /**
     * Проверяет, что манифест объявляет расширение notes с версией выше версии прежнего tracker
     */
    it('manifest_extensionAndVersion_areNotesAndAboveTrackerVersion', () => {
        expect(manifest.extension).toBe('notes');
        expect(manifest.version).toBeGreaterThan(11);
    });

    /**
     * Проверяет, что манифест не ссылается на типы Трекера задач
     */
    it('manifest_allowedChildren_referToOwnTypesOnly', () => {
        const own = new Set(manifest.types.map((t) => t.id));
        const foreign = manifest.types.flatMap((t) =>
            (t.allowedChildren ?? []).filter((child) => !own.has(child)),
        );
        expect(foreign).toEqual([]);
    });
});
