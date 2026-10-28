import { describe, expect, it } from 'vitest';

import { createDataController, ICON_REGISTRY } from '@platform';
import { PALETTE_COLORS } from '@platform/tree/colorRules';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureTasksStart, registerTasks } from './tasksExtension';

import type { DataController, TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

async function start(objects: unknown[] = []) {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    registerTasks(data);
    return { api, data };
}

function byType(data: DataController, type: string) {
    return data.getChildren(null).find((o) => o.type === type)!;
}

/**
 * Стартовая структура Трекера задач
 */
describe('Tasks: start structure', () => {
    /**
     * Проверяет, что без корней создаются задачи с двумя подгруппами одним набором, без заметок
     */
    it('startStructure_noRoots_createsTasksWithTwoSubgroupsInOneChangeset', async () => {
        const { api, data } = await start();

        const result = await ensureTasksStart(data);

        expect(result.ok).toBe(true);
        expect(api.changesets).toHaveLength(1);
        expect(
            data
                .getChildren(null)
                .map((o) => o.type)
                .sort(),
        ).toEqual(['SettingsRoot', 'TasksRoot']);
        const tasks = byType(data, 'TasksRoot');
        expect(data.getChildren(tasks.id).map((o) => o.type)).toEqual([
            'CurrentTasksRoot',
            'CompletedTasksRoot',
        ]);
    });

    /**
     * Проверяет, что повторный вызов без перезагрузки и после неё не создаёт дублей и ничего не отправляет
     */
    it('startStructure_calledTwice_createsNoDuplicatesAndSendsNothing', async () => {
        const { api, data } = await start();
        await ensureTasksStart(data);

        const again = await ensureTasksStart(data);
        // Повторный вход: модель загружается заново из того, что принял сервер
        api.objects = [
            ...data.getChildren(null),
            ...data.getChildren(byType(data, 'TasksRoot').id),
            ...data.getChildren(byType(data, 'SettingsRoot').id),
            ...data.getChildren(data.getChildren(byType(data, 'SettingsRoot').id)[0].id),
        ];
        await data.load();
        const afterReload = await ensureTasksStart(data);

        expect(again.ok && afterReload.ok).toBe(true);
        expect(api.changesets).toHaveLength(1);
        expect(data.getChildren(null)).toHaveLength(2);
    });

    /**
     * Проверяет, что при отказе сервера возвращается причина и частичной структуры не остаётся
     */
    it('startStructure_serverRejects_returnsReasonAndLeavesNoPartialStructure', async () => {
        const { api, data } = await start();
        api.rejectNext(400, 'нельзя');

        const result = await ensureTasksStart(data);

        expect(result).toMatchObject({ ok: false, error: 'нельзя' });
        expect(data.getChildren(null)).toEqual([]);
    });

    /**
     * Проверяет, что при незагруженных данных ничего не создаётся, чтобы не плодить дубли при сбое сети
     */
    it('startStructure_dataNotLoaded_createsNothingToAvoidDuplicatesOnNetworkFailure', async () => {
        const api = createFakeApi(types, []);
        api.get = () => Promise.reject(new Error('сеть недоступна'));
        const data = createDataController({ api });
        await data.load();

        const result = await ensureTasksStart(data);

        expect(result.ok).toBe(false);
        expect(api.changesets).toHaveLength(0);
    });
});

/**
 * Гонка при создании корней Трекера задач
 */
describe('Tasks: start structure under race', () => {
    /**
     * Проверяет, что отказ singleton_exists (корни уже созданы где-то ещё) считается «уже есть»
     */
    it('startStructure_singletonExists_isAlreadyThereNotError', async () => {
        const { api, data } = await start();
        api.objects = [
            { id: 't', type: 'TasksRoot', parent: null, order: 0, properties: {} },
            { id: 'c', type: 'CurrentTasksRoot', parent: 't', order: 0, properties: {} },
            { id: 'x', type: 'CompletedTasksRoot', parent: 't', order: 1, properties: {} },
        ];

        const result = await ensureTasksStart(data);

        expect(result.ok).toBe(true);
        expect(api.changesets).toHaveLength(0);
        expect(
            data
                .getChildren(null)
                .map((o) => o.type)
                .sort(),
        ).toEqual(['TasksRoot']);
    });

    /**
     * Проверяет, что 409 без кода перезагружает данные и повторяет создание один раз
     */
    it('startStructure_conflictWithoutCode_reloadsAndRetriesOnce', async () => {
        const { api, data } = await start();
        api.rejectNext(409, 'расхождение');

        const result = await ensureTasksStart(data);

        expect(result.ok).toBe(true);
        expect(api.changesets).toHaveLength(1);
        expect(data.getChildren(null)).toHaveLength(2);
    });
});

/**
 * Изоляция пользователей в Трекере задач
 */
describe('Tasks: user isolation', () => {
    /**
     * Проверяет, что структура достраивается по объектам, которые сервер отдал этому пользователю
     */
    it('isolation_structure_isCompletedFromObjectsServerGaveThisUser', async () => {
        // Сервер отдаёт пользователю только его объекты; у второго пользователя корней нет —
        // они создаются у него, а чужие объекты не появляются
        const own = [{ id: 'r1', type: 'TasksRoot', parent: null, order: 0, properties: {} }];
        const first = await start(own);
        const second = await start([]);

        await ensureTasksStart(first.data);
        await ensureTasksStart(second.data);

        // У первого «Задачи» уже есть и не дублируются
        expect(first.data.getChildren(null).filter((o) => o.type === 'TasksRoot')).toHaveLength(1);
        expect(first.data.getObject('r1')).toBeDefined();
        expect(second.data.getObject('r1')).toBeUndefined();
        expect(second.data.getChildren(null)).toHaveLength(2);
    });
});

/**
 * Согласованность манифеста Трекера задач с логикой
 */
describe('Tasks manifest: consistency with logic', () => {
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
     * Проверяет, что у каждого типа узла есть значок
     */
    it('manifest_everyNodeType_hasIcon', () => {
        const withoutIcon = manifest.types.filter((t) => !('icon' in t) || !t.icon);
        expect(withoutIcon.map((t) => t.id)).toEqual([]);
    });

    /**
     * Проверяет, что манифест объявляет расширение tasks с версией выше версии прежнего tracker
     */
    it('manifest_extensionAndVersion_areTasksAndAboveTrackerVersion', () => {
        expect(manifest.extension).toBe('tasks');
        expect(manifest.version).toBeGreaterThan(11);
    });

    /**
     * Проверяет, что манифест не ссылается на типы Трекера заметок
     */
    it('manifest_allowedChildren_referToOwnTypesOnly', () => {
        const own = new Set(manifest.types.map((t) => t.id));
        const foreign = manifest.types.flatMap((t) =>
            (t.allowedChildren ?? []).filter((child) => !own.has(child)),
        );
        expect(foreign).toEqual([]);
    });

    /**
     * Проверяет, что стартовая структура допустима так, как её проверил бы сервер
     */
    it('manifest_startStructure_isAcceptedAsServerWouldAcceptIt', async () => {
        const { api, data } = await start([]);

        const result = await ensureTasksStart(data);

        expect(result.ok).toBe(true);
        expect(api.changesets).toHaveLength(1);
        const created = (api.changesets[0].operations as { type: string }[]).map((o) => o.type);
        expect(created).toContain('CurrentTasksRoot');
        expect(created).toContain('CompletedTasksRoot');
    });
});
