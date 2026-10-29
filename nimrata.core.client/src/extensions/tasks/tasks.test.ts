import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform';
import { createFakeApi, whenSynced } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureTasksStart, registerTasks, taskDate } from './tasksExtension';

import type { DataController, DataObject, TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

async function start(options?: Parameters<typeof registerTasks>[1]) {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    registerTasks(data, options);
    await ensureTasksStart(data);
    return { api, data };
}

function current(data: DataController) {
    return data
        .getChildren(null)
        .flatMap((o) => data.getChildren(o.id))
        .find((o) => o.type === 'CurrentTasksRoot')!;
}

function byName(data: DataController, parent: string, name: string) {
    return data.getChildren(parent).find((o) => o.properties.name === name);
}

async function createTask(
    data: DataController,
    target: DataObject,
    params: Record<string, unknown>,
) {
    const result = await data.runAction(target.id, 'createTask', params);
    if (!result.ok) throw new Error(result.error);
}

/**
 * Создание задач Трекера
 */
describe('Tracker: task creation', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 2, 4, 10, 0)); // среда, 4 марта 2026
    });
    afterEach(() => vi.useRealTimers());

    /**
     * Проверяет, что задача с датой создаёт месяц и день в текущих задачах и кладётся в день
     */
    it('createTask_withDate_createsMonthAndDayInsideCurrentTasksAndPutsTaskInDay', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { name: 'Позвонить', date: '2026-03-05' });

        const month = byName(data, root.id, 'март, 2026')!;
        expect(month.type).toBe('Month');
        const day = byName(data, month.id, '05.03.2026, четверг')!;
        expect(day.type).toBe('Day');
        const tasks = data.getChildren(day.id);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].type).toBe('Task');
        expect(tasks[0].properties.name).toBe('Позвонить');
        expect(tasks[0].properties.name).toBe('Позвонить');
    });

    /**
     * Проверяет, что без даты используется сегодняшняя
     */
    it('createTask_withoutDate_usesToday', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { name: 'Сегодняшняя' });

        const month = byName(data, root.id, 'март, 2026')!;
        expect(byName(data, month.id, '04.03.2026, среда')).toBeDefined();
    });

    /**
     * Проверяет, что создание целиком идёт одним набором изменений
     */
    it('createTask_everything_isOneChangeset', async () => {
        const { api, data } = await start();
        await whenSynced(data);
        const before = api.changesets.length;

        await createTask(data, current(data), { name: 'А', date: '2026-04-01' });

        await whenSynced(data);
        expect(api.changesets.length - before).toBe(1);
    });

    /**
     * Проверяет, что существующие месяц и день используются повторно
     */
    it('createTask_existingMonthAndDay_areReused', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { name: 'Раз', date: '2026-03-05' });
        await createTask(data, root, { name: 'Два', date: '2026-03-05' });
        await createTask(data, root, { name: 'Три', date: '2026-03-06' });

        expect(data.getChildren(root.id)).toHaveLength(1);
        const month = data.getChildren(root.id)[0];
        expect(data.getChildren(month.id)).toHaveLength(2);
        expect(data.getChildren(byName(data, month.id, '05.03.2026, четверг')!.id)).toHaveLength(2);
    });

    /**
     * Проверяет, что пустое название не допускается
     */
    it('createTask_emptyName_isNotAllowed', async () => {
        const { data } = await start();

        const result = await data.runAction(current(data).id, 'createTask', { name: '  ' });

        expect(result.ok).toBe(false);
    });

    /**
     * Проверяет, что имя со временем — «время — название» и пересчитывается при правке
     */
    it('taskName_withTime_isTimeDashTitleAndRecomputedOnEdit', async () => {
        const { data } = await start();
        await createTask(data, current(data), { name: 'Позвонить', date: '2026-03-05' });
        const task = findTask(data, 'Позвонить');

        await data.setProperty(task.id, 'time', '09:30');
        expect(data.getTitle(data.getObject(task.id)!)).toBe('09:30 — Позвонить');

        await data.setProperty(task.id, 'name', 'Написать');
        expect(data.getTitle(data.getObject(task.id)!)).toBe('09:30 — Написать');

        await data.setProperty(task.id, 'time', null);
        expect(data.getTitle(data.getObject(task.id)!)).toBe('Написать');
    });

    /**
     * Проверяет, что дата задачи выводится из дня-родителя и нигде не хранится
     */
    it('taskDate_isDerivedFromParentDayAndStoredNowhere', async () => {
        const { data } = await start();
        await createTask(data, current(data), { name: 'Д', date: '2026-03-05' });
        const task = findTask(data, 'Д');

        expect(taskDate(data, task)).toBe('2026-03-05');
        expect(Object.keys(task.properties)).not.toContain('date');
    });
});

/**
 * Категории задач Трекера
 */
describe('Tracker: categories', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 2, 4, 10, 0));
    });
    afterEach(() => vi.useRealTimers());

    /**
     * Проверяет, что категория создаётся в дне, а повторное имя находит существующую
     */
    it('category_created_insideDayAndRepeatedNameFindsExisting', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { name: 'А', date: '2026-03-05', category: 'Работа' });
        await createTask(data, root, { name: 'Б', date: '2026-03-05', category: 'Работа' });
        await createTask(data, root, { name: 'В', date: '2026-03-05', category: 'Личное' });

        const month = data.getChildren(root.id)[0];
        const day = data.getChildren(month.id)[0];
        const categories = data.getChildren(day.id);
        expect(categories.map((c) => c.properties.name).sort()).toEqual(['Личное', 'Работа']);
        const work = categories.find((c) => c.properties.name === 'Работа')!;
        expect(data.getChildren(work.id)).toHaveLength(2);
    });

    /**
     * Проверяет, что действие над категорией создаёт вложенную категорию
     */
    it('category_actionOnCategory_createsNestedCategoryInsideIt', async () => {
        const { data } = await start();
        const root = current(data);
        await createTask(data, root, { name: 'А', date: '2026-03-05', category: 'Работа' });
        const work = findCategory(data, 'Работа');

        await createTask(data, work, { name: 'Б', category: 'Проект' });
        // Без даты на категории задача создаётся в день категории, а не на сегодня
        const nested = data.getChildren(work.id).find((o) => o.type === 'Category')!;
        expect(nested.properties.name).toBe('Проект');
        expect(taskDate(data, data.getChildren(nested.id)[0])).toBe('2026-03-05');
    });

    /**
     * Проверяет, что действие над категорией без указания категории кладёт задачу в неё
     */
    it('category_actionOnCategoryWithoutCategory_putsTaskInIt', async () => {
        const { data } = await start();
        await createTask(data, current(data), {
            name: 'А',
            date: '2026-03-05',
            category: 'Работа',
        });
        const work = findCategory(data, 'Работа');

        await createTask(data, work, { name: 'Б' });

        expect(data.getChildren(work.id)).toHaveLength(2);
    });

    /**
     * Проверяет, что действие над днём с другой датой создаёт задачу в этом дне
     */
    it('category_actionOnDayWithOtherDate_createsTaskInThatDay', async () => {
        const { data } = await start();
        await createTask(data, current(data), { name: 'А', date: '2026-03-05' });
        const month = data.getChildren(current(data).id)[0];
        const day = data.getChildren(month.id)[0];

        await createTask(data, day, { name: 'Б', date: '2026-03-09' });

        expect(taskDate(data, findTask(data, 'Б'))).toBe('2026-03-09');
        expect(data.getChildren(month.id)).toHaveLength(2);
    });

    /**
     * Проверяет, что в архиве без даты задача создаётся на сегодня в текущих задачах, а не в архиве
     */
    it('category_inArchiveWithoutDate_createsTaskForTodayInCurrentTasksNotArchive', async () => {
        const { data } = await start();
        await createTask(data, current(data), {
            name: 'Старая',
            date: '2026-03-02',
            category: 'Работа',
        });
        const old = findTask(data, 'Старая');
        await data.runAction(old.id, 'complete');
        const archived = data.getObject(findTask(data, 'Старая').parent!)!;
        expect(archived.type).toBe('Category');

        await createTask(data, archived, { name: 'Новая' });

        const created = findTask(data, 'Новая');
        expect(created.properties.status).toBeUndefined();
        expect(taskDate(data, created)).toBe('2026-03-04');
        const archiveRoot = data
            .getChildren(null)
            .flatMap((o) => data.getChildren(o.id))
            .find((o) => o.type === 'CompletedTasksRoot')!;
        const underArchive = (id: string | null): boolean =>
            id !== null && (id === archiveRoot.id || underArchive(data.getObject(id)!.parent));
        expect(underArchive(created.parent)).toBe(false);
    });
});

/**
 * Дни, порядок и выходные
 */
describe('Tracker: days, number, weekends', () => {
    /**
     * Проверяет, что суббота и воскресенье — выходные дни, а будни — обычные
     */
    it('days_saturdayAndSunday_areWeekendDayWeekdaysAreDay', async () => {
        const { data } = await start();
        const root = current(data);

        for (const date of ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09']) {
            await createTask(data, root, { name: date, date });
        }

        const month = data.getChildren(root.id)[0];
        const types = Object.fromEntries(
            data.getChildren(month.id).map((d) => [d.properties.date, d.type]),
        );
        expect(types).toEqual({
            '2026-03-06': 'Day',
            '2026-03-07': 'DayOff',
            '2026-03-08': 'DayOff',
            '2026-03-09': 'Day',
        });
    });

    /**
     * Проверяет, что месяцы и дни упорядочены по дате независимо от порядка создания
     */
    it('days_monthsAndDays_getOrderByDateRegardlessOfCreationOrder', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { name: 'a', date: '2026-12-10' });
        await createTask(data, root, { name: 'b', date: '2026-02-20' });
        await createTask(data, root, { name: 'c', date: '2026-02-03' });

        const months = [...data.getChildren(root.id)].sort((x, y) => x.number - y.number);
        expect(months.map((m) => m.properties.date)).toEqual(['2026-02-01', '2026-12-01']);
        const days = [...data.getChildren(months[0].id)].sort((x, y) => x.number - y.number);
        expect(days.map((d) => d.properties.date)).toEqual(['2026-02-03', '2026-02-20']);
    });

    /**
     * Проверяет, что 2027 год идёт после декабря 2026
     */
    it('days_year2027_comesAfterDecember2026', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { name: 'a', date: '2027-01-10' });
        await createTask(data, root, { name: 'b', date: '2026-12-10' });

        const months = [...data.getChildren(root.id)].sort((x, y) => x.number - y.number);
        expect(months.map((m) => m.properties.date)).toEqual(['2026-12-01', '2027-01-01']);
    });

    /**
     * Проверяет, что недопустимая дата отклоняется
     */
    it('days_invalidDate_isRejected', async () => {
        const { data } = await start();

        const result = await data.runAction(current(data).id, 'createTask', {
            name: 'x',
            date: '2026-02-31',
        });

        expect(result.ok).toBe(false);
    });
});

/**
 * Порядок задач в дне
 */
describe('Tracker: task number in a day', () => {
    /**
     * Проверяет, что задачи дня упорядочены по времени независимо от порядка создания, а без времени идут первыми
     */
    it('taskOrder_tasksOfDay_sortedByTimeRegardlessOfCreationOrderWithoutTimeFirst', async () => {
        const { data } = await start();
        const root = current(data);
        for (const title of ['Поздняя', 'Ранняя', 'Без времени']) {
            await createTask(data, root, { name: title, date: '2026-03-05' });
        }
        await data.setProperty(findTask(data, 'Поздняя').id, 'time', '18:00');
        await data.setProperty(findTask(data, 'Ранняя').id, 'time', '09:00');

        const day = data.getChildren(data.getChildren(root.id)[0].id)[0];
        const ordered = [...data.getChildren(day.id)].sort((a, b) => a.number - b.number);
        expect(ordered.map((t) => t.properties.name)).toEqual(['Без времени', 'Ранняя', 'Поздняя']);
    });
});

/**
 * Ссылки задач Трекера
 */
describe('Tracker: task links', () => {
    /**
     * Проверяет, что внешняя ссылка http открывается в новой вкладке
     */
    it('taskLinks_openExternalLink_opensHttpInNewTab', async () => {
        const { data } = await start();
        await createTask(data, current(data), { name: 'А', date: '2026-03-05' });
        const task = findTask(data, 'А');
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        await data.setProperty(task.id, 'link', 'https://example.com/x');

        const result = await data.runAction(task.id, 'openExternalLink');

        expect(result.ok).toBe(true);
        expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');
        open.mockRestore();
    });

    /**
     * Проверяет, что внешняя ссылка не по http отклоняется
     */
    it('taskLinks_externalLinkNotHttp_isRejected', async () => {
        const { data } = await start();
        await createTask(data, current(data), { name: 'А', date: '2026-03-05' });
        const task = findTask(data, 'А');
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        await data.setProperty(task.id, 'link', 'javascript:alert(1)');

        const result = await data.runAction(task.id, 'openExternalLink');

        expect(result.ok).toBe(false);
        expect(open).not.toHaveBeenCalled();
        open.mockRestore();
    });

    /**
     * Проверяет, что внутренняя ссылка показывает целевой объект в дереве
     */
    it('taskLinks_openInternalLink_showsTargetObjectInTree', async () => {
        const reveal = vi.fn();
        const { data } = await start({ reveal });
        await createTask(data, current(data), { name: 'А', date: '2026-03-05' });
        await createTask(data, current(data), { name: 'Б', date: '2026-03-06' });
        const a = findTask(data, 'А');
        const b = findTask(data, 'Б');
        await data.setProperty(a.id, 'internalLink', b.id);

        const result = await data.runAction(a.id, 'openInternalLink');

        expect(result.ok).toBe(true);
        expect(reveal).toHaveBeenCalledWith(b.id);
    });

    /**
     * Проверяет, что внутренняя ссылка на удалённый объект даёт понятную ошибку
     */
    it('taskLinks_internalLinkToDeletedObject_givesClearError', async () => {
        const reveal = vi.fn();
        const { data } = await start({ reveal });
        await createTask(data, current(data), { name: 'А', date: '2026-03-05' });
        const a = findTask(data, 'А');
        // Сервер не принимает ссылку на несуществующий объект: ссылка повисает после удаления цели
        await createTask(data, current(data), { name: 'Б', date: '2026-03-06' });
        const b = findTask(data, 'Б');
        await data.setProperty(a.id, 'internalLink', b.id);
        await data.remove(b.id);
        reveal.mockClear();

        const result = await data.runAction(a.id, 'openInternalLink');

        expect(result).toEqual({ ok: false, error: 'Объект по ссылке недоступен.' });
        expect(reveal).not.toHaveBeenCalled();
    });

    /**
     * Проверяет, что действия со ссылками недоступны, пока ссылка не задана
     */
    it('taskLinks_linkActions_unavailableUntilLinkIsSet', async () => {
        const { data } = await start();
        await createTask(data, current(data), { name: 'А', date: '2026-03-05' });
        const task = findTask(data, 'А');

        const ids = data.getActions(task.id, 'contextMenu').map((a) => a.id);

        expect(ids).not.toContain('openExternalLink');
        expect(ids).not.toContain('openInternalLink');
    });
});

/**
 * Манифест Трекера: задача
 */
describe('Tracker manifest: task', () => {
    /**
     * Проверяет, что в манифесте описаны свойства задачи и правила цвета по приоритету
     */
    it('manifest_taskProperties_andPriorityColorRulesAreDescribed', () => {
        const task = manifest.types.find((t) => t.id === 'Task')!;

        expect(task.properties!.map((p) => p.id)).toEqual(
            expect.arrayContaining([
                'comment',
                'priority',
                'time',
                'notifyBefore',
                'status',
                'link',
                'internalLink',
                'repeat',
                'repeatId',
            ]),
        );
        expect(task.properties!.find((p) => p.id === 'repeatId')).toMatchObject({ hidden: true });
        expect(task.colorRules!.map((r) => [r.property, r.equals, r.color])).toEqual(
            expect.arrayContaining([
                ['priority', 'medium', 'orange'],
                ['priority', 'high', 'red'],
            ]),
        );
    });
});

function findCategory(data: DataController, name: string): DataObject {
    const walk = (parent: string | null): DataObject | undefined => {
        for (const c of data.getChildren(parent)) {
            if (c.type === 'Category' && c.properties.name === name) return c;
            const found = walk(c.id);
            if (found) return found;
        }
    };
    return walk(null)!;
}

function findTask(data: DataController, title: string): DataObject {
    const walk = (parent: string | null): DataObject | undefined => {
        for (const child of data.getChildren(parent)) {
            if (child.type === 'Task' && child.properties.name === title) return child;
            const found = walk(child.id);
            if (found) return found;
        }
    };
    return walk(null)!;
}
