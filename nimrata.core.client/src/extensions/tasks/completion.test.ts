import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform';
import { createFakeApi, whenSynced } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureTasksStart, registerTasks } from './tasksExtension';

import type { DataController, DataObject, TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

async function start() {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    registerTasks(data);
    await ensureTasksStart(data);
    return { api, data };
}

function root(data: DataController, type: string) {
    return data
        .getChildren(null)
        .flatMap((o) => data.getChildren(o.id))
        .find((o) => o.type === type)!;
}

async function run(
    data: DataController,
    target: DataObject,
    action: string,
    params: Record<string, unknown> = {},
) {
    return data.runAction(target.id, action, params);
}

async function createTask(data: DataController, params: Record<string, unknown>) {
    const result = await run(data, root(data, 'CurrentTasksRoot'), 'createTask', params);
    if (!result.ok) throw new Error(result.error);
}

/**
 * Находит единственную задачу с названием
 */
function task(data: DataController, title: string) {
    const all: DataObject[] = [];
    const walk = (parent: string | null) =>
        data.getChildren(parent).forEach((o) => {
            if (o.type === 'Task' && o.properties.name === title) all.push(o);
            walk(o.id);
        });
    walk(null);
    expect(all).toHaveLength(1);
    return all[0];
}

/**
 * Цепочка названий от корня до объекта
 */
function path(data: DataController, object: DataObject): string[] {
    const names: string[] = [];
    let current: DataObject | undefined = object;
    while (current) {
        names.unshift(String(current.properties.name ?? data.getType(current.type)?.name));
        current = current.parent ? data.getObject(current.parent) : undefined;
    }
    return names;
}

async function moveIntoNewCategory(data: DataController, title: string, name: string) {
    const created = await data.create({
        type: 'Category',
        parent: task(data, title).parent!,
        properties: { name },
    });
    if (!created.ok) throw new Error(created.error);
    await data.move(task(data, title).id, { parent: created.id });
    return created.id;
}

/**
 * Завершение и откладывание задач Трекера
 */
describe('Tracker: complete and postpone', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 2, 4, 10, 0)); // среда, 4 марта 2026
    });
    afterEach(() => vi.useRealTimers());

    /**
     * Завершение задачи
     */
    describe('Complete', () => {
        /**
         * Проверяет, что завершение ставит статус и переносит задачу в архив на ту же дату, создавая год, месяц и день
         */
        it('complete_task_setsStatusAndMovesToArchiveOnSameDateCreatingYearMonthDay', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Позвонить', date: '2026-03-05' });

            const result = await run(data, task(data, 'Позвонить'), 'complete');

            expect(result.ok).toBe(true);
            const done = task(data, 'Позвонить');
            expect(done.properties.status).toBe('completed');
            expect(path(data, done).slice(1)).toEqual([
                'Завершённые задачи',
                '2026',
                'март, 2026',
                '05.03.2026, четверг',
                'Позвонить',
            ]);
            const year = data.getChildren(root(data, 'CompletedTasksRoot').id)[0];
            expect(year.type).toBe('Year');
            expect(year.properties.date).toBe('2026-01-01');
            const month = data.getChildren(year.id)[0];
            expect(month.type).toBe('Month');
            expect(month.properties.date).toBe('2026-03-01');
            expect(data.getObject(done.parent!)!.type).toBe('Day');
        });

        /**
         * Проверяет, что завершение использует существующие узлы архива без дублей
         */
        it('complete_task_reusesExistingArchiveNodesWithoutDuplicates', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Раз', date: '2026-03-05' });
            await createTask(data, { name: 'Два', date: '2026-03-05' });

            await run(data, task(data, 'Раз'), 'complete');
            await run(data, task(data, 'Два'), 'complete');

            expect(data.getChildren(root(data, 'CompletedTasksRoot').id)).toHaveLength(1);
            expect(task(data, 'Раз').parent).toBe(task(data, 'Два').parent);
        });

        /**
         * Проверяет, что день архива для задачи выходного дня получает тип выходного
         */
        it('complete_weekendTask_archiveDayGetsWeekendType', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Отдых', date: '2026-03-07' }); // суббота

            await run(data, task(data, 'Отдых'), 'complete');

            expect(data.getObject(task(data, 'Отдых').parent!)!.type).toBe('DayOff');
        });

        /**
         * Проверяет, что цепочка категорий воссоздаётся по названиям, а опустевшие текущие удаляются
         */
        it('complete_task_recreatesCategoryChainByNamesAndRemovesEmptiedCurrentOnes', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Купить', date: '2026-03-05', category: 'Дом' });
            await moveIntoNewCategory(data, 'Купить', 'Кухня');
            const dayBefore = data.getObject(task(data, 'Купить').parent!)!.parent!;
            const dayId = data.getObject(dayBefore)!.parent!;

            await run(data, task(data, 'Купить'), 'complete');

            expect(path(data, task(data, 'Купить')).slice(5)).toEqual(['Дом', 'Кухня', 'Купить']);
            expect(data.getChildren(dayId)).toHaveLength(0);
            expect(data.getObject(dayId)).toBeDefined();
        });

        /**
         * Проверяет, что категория остаётся, пока в ней есть другие задачи
         */
        it('complete_task_keepsCategoryWhenOtherTasksRemain', async () => {
            const { data } = await start();
            await createTask(data, { name: 'А', date: '2026-03-05', category: 'Дом' });
            await createTask(data, { name: 'Б', date: '2026-03-05', category: 'Дом' });

            await run(data, task(data, 'А'), 'complete');

            expect(data.getObject(task(data, 'Б').parent!)!.type).toBe('Category');
            expect(path(data, task(data, 'А')).at(-2)).toBe('Дом');
        });

        /**
         * Проверяет, что завершение выполняется одним набором изменений
         */
        it('complete_task_runsInSingleChangeset', async () => {
            const { api, data } = await start();
            await createTask(data, { name: 'Одна', date: '2026-03-05', category: 'Дом' });
            await whenSynced(data);
            const before = api.changesets.length;

            await run(data, task(data, 'Одна'), 'complete');

            await whenSynced(data);
            expect(api.changesets.length - before).toBe(1);
        });

        /**
         * Проверяет, что отмена возвращает задачу, категорию и статус
         */
        it('complete_undo_restoresTaskCategoryAndStatus', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Одна', date: '2026-03-05', category: 'Дом' });
            const before = path(data, task(data, 'Одна'));

            await run(data, task(data, 'Одна'), 'complete');
            const undone = await data.undo();

            expect(undone.ok).toBe(true);
            const back = task(data, 'Одна');
            expect(path(data, back)).toEqual(before);
            expect(back.properties.status).toBeUndefined();
            expect(data.getChildren(root(data, 'CompletedTasksRoot').id)).toHaveLength(0);
        });

        /**
         * Проверяет, что уже завершённую задачу завершить нельзя
         */
        it('complete_alreadyCompletedTask_isUnavailable', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Одна' });
            await run(data, task(data, 'Одна'), 'complete');

            const ids = data.getActions(task(data, 'Одна').id, 'contextMenu').map((a) => a.id);

            expect(ids).not.toContain('complete');
            expect(ids).not.toContain('postpone');
        });

        /**
         * Проверяет, что действие доступно для текущей задачи в контекстном меню и таблице свойств
         */
        it('complete_currentTask_availableInContextMenuAndPropertyGrid', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Одна' });

            for (const placement of ['contextMenu', 'propertyGrid'] as const) {
                const ids = data.getActions(task(data, 'Одна').id, placement).map((a) => a.id);
                expect(ids).toContain('complete');
                expect(ids).toContain('postpone');
            }
        });
    });

    /**
     * Откладывание задачи
     */
    describe('Postpone', () => {
        /**
         * Проверяет, что откладывание переносит задачу в день выбранной даты, создавая месяц и день
         */
        it('postpone_task_movesToDayOfChosenDateCreatingMonthAndDay', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Позже' });

            const result = await run(data, task(data, 'Позже'), 'postpone', { date: '2026-04-10' });

            expect(result.ok).toBe(true);
            expect(path(data, task(data, 'Позже')).slice(1)).toEqual([
                'Текущие задачи',
                'апрель, 2026',
                '10.04.2026, пятница',
                'Позже',
            ]);
            expect(task(data, 'Позже').properties.status).toBeUndefined();
        });

        /**
         * Проверяет, что откладывание переносит задачу с цепочкой категорий и удаляет опустевшие
         */
        it('postpone_task_movesWithCategoryChainAndRemovesEmptied', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Дело', category: 'Работа' });
            const oldDay = data.getObject(task(data, 'Дело').parent!)!.parent!;

            await run(data, task(data, 'Дело'), 'postpone', { date: '2026-03-06' });

            expect(path(data, task(data, 'Дело')).slice(-3)).toEqual([
                '06.03.2026, пятница',
                'Работа',
                'Дело',
            ]);
            expect(data.getChildren(oldDay)).toHaveLength(0);
        });

        /**
         * Проверяет, что откладывание использует существующую категорию целевого дня
         */
        it('postpone_task_reusesExistingCategoryOfTargetDay', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Уже', date: '2026-03-06', category: 'Работа' });
            await createTask(data, { name: 'Дело', category: 'Работа' });

            await run(data, task(data, 'Дело'), 'postpone', { date: '2026-03-06' });

            expect(task(data, 'Дело').parent).toBe(task(data, 'Уже').parent);
        });

        /**
         * Проверяет, что порядок в новом дне соответствует времени задачи
         */
        it('postpone_task_orderInNewDayMatchesTime', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Дело' });
            await data.setProperty(task(data, 'Дело').id, 'time', '09:30');

            await run(data, task(data, 'Дело'), 'postpone', { date: '2026-03-06' });

            expect(task(data, 'Дело').number).toBe(2 + 9 * 60 + 30);
        });

        /**
         * Проверяет, что откладывание идёт одним набором, а отмена возвращает задачу и категории
         */
        it('postpone_task_runsInSingleChangesetAndUndoRestoresTaskAndCategories', async () => {
            const { api, data } = await start();
            await createTask(data, { name: 'Дело', category: 'Работа' });
            const before = path(data, task(data, 'Дело'));
            await whenSynced(data);
            const count = api.changesets.length;

            await run(data, task(data, 'Дело'), 'postpone', { date: '2026-05-01' });
            await whenSynced(data);
            expect(api.changesets.length - count).toBe(1);
            await data.undo();

            expect(path(data, task(data, 'Дело'))).toEqual(before);
            const current = root(data, 'CurrentTasksRoot');
            expect(data.getChildren(current.id).map((m) => m.properties.name)).toEqual([
                'март, 2026',
            ]);
        });

        /**
         * Проверяет, что откладывание на ту же дату ничего не меняет
         */
        it('postpone_sameDate_changesNothing', async () => {
            const { api, data } = await start();
            await createTask(data, { name: 'Дело', category: 'Работа' });
            await whenSynced(data);
            const count = api.changesets.length;
            const before = path(data, task(data, 'Дело'));

            const result = await run(data, task(data, 'Дело'), 'postpone', { date: '2026-03-04' });

            expect(result.ok).toBe(true);
            expect(path(data, task(data, 'Дело'))).toEqual(before);
            await whenSynced(data);
            expect(api.changesets.length).toBe(count);
        });

        /**
         * Проверяет, что откладывание на пустую или недопустимую дату отклоняется и ничего не меняет
         */
        it.each([[''], ['4 марта'], ['2026-02-30']])(
            'postpone_invalidDate_isRejected_%s',
            async (date) => {
                const { data } = await start();
                await createTask(data, { name: 'Дело' });
                const before = path(data, task(data, 'Дело'));

                const result = await run(data, task(data, 'Дело'), 'postpone', { date });

                expect(result.ok).toBe(false);
                expect(path(data, task(data, 'Дело'))).toEqual(before);
            },
        );
    });

    /**
     * Откладывание категории
     */
    describe('Postpone category', () => {
        /**
         * Проверяет, что все задачи категории переезжают в выбранный день с той же категорией, а старый день очищается
         */
        it('postpone_category_movesAllTasksToChosenDayKeepingCategory', async () => {
            const { data } = await start();
            await createTask(data, { name: 'А', category: 'Работа' });
            await createTask(data, { name: 'Б', category: 'Работа' });
            const category = task(data, 'А').parent!;
            const oldDay = data.getObject(category)!.parent!;

            const result = await run(data, data.getObject(category)!, 'postpone', {
                date: '2026-04-10',
            });

            expect(result.ok).toBe(true);
            for (const title of ['А', 'Б']) {
                expect(path(data, task(data, title)).slice(1)).toEqual([
                    'Текущие задачи',
                    'апрель, 2026',
                    '10.04.2026, пятница',
                    'Работа',
                    title,
                ]);
            }
            expect(task(data, 'А').parent).toBe(task(data, 'Б').parent);
            expect(data.getChildren(oldDay)).toHaveLength(0);
        });

        /**
         * Проверяет, что вложенная категория переносится целиком вместе с цепочкой, а опустевшие удаляются
         */
        it('postpone_category_nestedCategoryMovesWholeAndEmptiedAreRemoved', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Дело', category: 'Работа' });
            await createTask(data, { name: 'Рядом', category: 'Работа' });
            await moveIntoNewCategory(data, 'Дело', 'Проект');
            const outer = task(data, 'Рядом').parent!;
            const oldDay = data.getObject(outer)!.parent!;

            await run(data, data.getObject(outer)!, 'postpone', { date: '2026-03-06' });

            expect(path(data, task(data, 'Дело')).slice(-4)).toEqual([
                '06.03.2026, пятница',
                'Работа',
                'Проект',
                'Дело',
            ]);
            expect(path(data, task(data, 'Рядом')).slice(-3)).toEqual([
                '06.03.2026, пятница',
                'Работа',
                'Рядом',
            ]);
            expect(data.getChildren(oldDay)).toHaveLength(0);
        });

        /**
         * Проверяет, что откладывание вложенной категории сохраняет цепочку внешних категорий
         */
        it('postpone_innerCategory_keepsOuterChainAndKeepsOuterWithOtherTasks', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Дело', category: 'Работа' });
            await createTask(data, { name: 'Рядом', category: 'Работа' });
            const inner = await moveIntoNewCategory(data, 'Дело', 'Проект');
            const outer = task(data, 'Рядом').parent!;

            await run(data, data.getObject(inner)!, 'postpone', { date: '2026-03-06' });

            expect(path(data, task(data, 'Дело')).slice(-4)).toEqual([
                '06.03.2026, пятница',
                'Работа',
                'Проект',
                'Дело',
            ]);
            expect(task(data, 'Рядом').parent).toBe(outer);
            expect(data.getObject(inner)).toBeUndefined();
        });

        /**
         * Проверяет, что повторяющиеся задачи переносятся как обычные, а остальные повторы набора не трогаются
         */
        it('postpone_category_repeatingTaskMovesOthersOfSetStay', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Повтор', date: '2026-03-04', category: 'Работа' });
            await data.setProperty(task(data, 'Повтор').id, 'repeat', 'weekly');
            const all = () => {
                const found: DataObject[] = [];
                const walk = (parent: string | null) =>
                    data.getChildren(parent).forEach((o) => {
                        if (o.type === 'Task' && o.properties.name === 'Повтор') found.push(o);
                        walk(o.id);
                    });
                walk(null);
                return found;
            };
            const dates = () =>
                all()
                    .map((t) => t.parent && path(data, t).slice(-3)[0])
                    .sort();
            const first = all().find((t) => path(data, t).slice(-3)[0] === '04.03.2026, среда')!;
            const before = dates();
            expect(before.length).toBeGreaterThan(1);

            const result = await run(data, data.getObject(first.parent!)!, 'postpone', {
                date: '2026-03-20',
            });

            expect(result.ok).toBe(true);
            const after = dates();
            expect(after).toHaveLength(before.length);
            expect(after).toContain('20.03.2026, пятница');
            expect(after).not.toContain('04.03.2026, среда');
        });

        /**
         * Проверяет, что откладывание пустой категории ничего не меняет: категория остаётся на месте
         */
        it('postpone_emptyCategory_changesNothing', async () => {
            const { api, data } = await start();
            await createTask(data, { name: 'Дело', category: 'Работа' });
            const day = data.getObject(task(data, 'Дело').parent!)!.parent!;
            const created = await data.create({
                type: 'Category',
                parent: day,
                properties: { name: 'Пусто' },
            });
            if (!created.ok) throw new Error(created.error);
            await whenSynced(data);
            const count = api.changesets.length;

            const result = await run(data, data.getObject(created.id)!, 'postpone', {
                date: '2026-03-20',
            });

            expect(result.ok).toBe(true);
            expect(data.getObject(created.id)).toBeDefined();
            await whenSynced(data);
            expect(api.changesets.length).toBe(count);
        });

        /**
         * Проверяет, что откладывание идёт одним набором, а отмена возвращает всё
         */
        it('postpone_category_runsInSingleChangesetAndUndoRestoresAll', async () => {
            const { api, data } = await start();
            await createTask(data, { name: 'А', category: 'Работа' });
            await createTask(data, { name: 'Б', category: 'Работа' });
            const before = [path(data, task(data, 'А')), path(data, task(data, 'Б'))];
            const category = task(data, 'А').parent!;
            await whenSynced(data);
            const count = api.changesets.length;

            await run(data, data.getObject(category)!, 'postpone', { date: '2026-05-01' });
            await whenSynced(data);
            expect(api.changesets.length - count).toBe(1);
            await data.undo();

            expect([path(data, task(data, 'А')), path(data, task(data, 'Б'))]).toEqual(before);
        });

        /**
         * Проверяет, что действие есть в контекстном меню и таблице свойств, а недопустимая дата отклоняется
         */
        it('postpone_category_availableAndRejectsInvalidDate', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Дело', category: 'Работа' });
            const category = data.getObject(task(data, 'Дело').parent!)!;
            const before = path(data, task(data, 'Дело'));

            for (const placement of ['contextMenu', 'propertyGrid'] as const) {
                expect(data.getActions(category.id, placement).map((a) => a.id)).toContain(
                    'postpone',
                );
            }
            const result = await run(data, category, 'postpone', { date: '2026-02-30' });

            expect(result.ok).toBe(false);
            expect(path(data, task(data, 'Дело'))).toEqual(before);
        });

        /**
         * Проверяет, что завершённые задачи категории архива не переносятся в текущие
         */
        it('postpone_category_doesNotMoveCompletedTasks', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Готово', category: 'Работа' });
            await createTask(data, { name: 'Ждёт', category: 'Работа' });
            await run(data, task(data, 'Готово'), 'complete');
            const category = task(data, 'Ждёт').parent!;

            await run(data, data.getObject(category)!, 'postpone', { date: '2026-03-20' });

            expect(path(data, task(data, 'Готово'))[1]).toBe('Завершённые задачи');
            expect(path(data, task(data, 'Ждёт'))[1]).toBe('Текущие задачи');
        });
    });

    /**
     * Удаление задач
     */
    describe('Task deletion', () => {
        /**
         * Проверяет, что удаление задачи убирает всю опустевшую цепочку категорий до дня
         */
        it('delete_task_removesWholeEmptiedCategoryChainUpToDay', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Дело', category: 'Работа' });
            const inner = await moveIntoNewCategory(data, 'Дело', 'Проект');
            const day = data.getObject(data.getObject(inner)!.parent!)!.parent!;

            const result = await data.remove(task(data, 'Дело').id);

            expect(result.ok).toBe(true);
            expect(data.getChildren(day)).toHaveLength(0);
            expect(data.getObject(day)).toBeDefined();
        });

        /**
         * Проверяет, что категория с другими объектами остаётся
         */
        it('delete_task_keepsCategoryWithOtherObjects', async () => {
            const { data } = await start();
            await createTask(data, { name: 'А', category: 'Работа' });
            await createTask(data, { name: 'Б', category: 'Работа' });
            const category = task(data, 'А').parent!;

            await data.remove(task(data, 'А').id);

            expect(data.getObject(category)).toBeDefined();
        });

        /**
         * Проверяет, что удаление и очистка идут одним набором, а отмена возвращает всё
         */
        it('delete_task_deletionAndCleanupAreOneChangesetAndUndoRestoresAll', async () => {
            const { api, data } = await start();
            await createTask(data, { name: 'Дело', category: 'Работа' });
            const before = path(data, task(data, 'Дело'));
            await whenSynced(data);
            const count = api.changesets.length;

            await data.remove(task(data, 'Дело').id);
            await whenSynced(data);
            expect(api.changesets.length - count).toBe(1);
            await data.undo();

            expect(path(data, task(data, 'Дело'))).toEqual(before);
        });

        /**
         * Проверяет, что удаление задачи прямо в дне оставляет день
         */
        it('delete_taskDirectlyInDay_keepsDay', async () => {
            const { data } = await start();
            await createTask(data, { name: 'Дело' });
            const day = task(data, 'Дело').parent!;

            await data.remove(task(data, 'Дело').id);

            expect(data.getObject(day)).toBeDefined();
        });
    });
});
