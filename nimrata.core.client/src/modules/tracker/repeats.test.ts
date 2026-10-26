import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { checkNotifications, createNotificationState } from './notifications';
import { ensureRepeats } from './repeats';
import { taskDate } from './tasks';
import { ensureStartStructure, registerTracker } from './tracker';

import type { DataController, DataObject, TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    module: manifest.module,
    moduleVersion: manifest.version,
})) as TypeDefinition[];

async function start() {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    registerTracker(data);
    await ensureStartStructure(data);
    return { api, data };
}

function root(data: DataController, type: string) {
    return data
        .getChildren(null)
        .flatMap((o) => data.getChildren(o.id))
        .find((o) => o.type === type)!;
}

function allTasks(data: DataController): DataObject[] {
    const all: DataObject[] = [];
    const walk = (parent: string | null) =>
        data.getChildren(parent).forEach((o) => {
            if (o.type === 'Task') all.push(o);
            walk(o.id);
        });
    walk(null);
    return all;
}

/**
 * Задачи с названием, по возрастанию даты
 */
function series(data: DataController, title: string) {
    return allTasks(data)
        .filter((t) => t.properties.title === title)
        .sort((a, b) => taskDate(data, a)!.localeCompare(taskDate(data, b)!));
}

const dates = (data: DataController, title: string) =>
    series(data, title).map((t) => taskDate(data, t));

async function addTask(data: DataController, title: string, date: string, category?: string) {
    const params: Record<string, unknown> = { title, date };
    if (category) params.category = category;
    const result = await data.runAction(root(data, 'CurrentTasksRoot').id, 'createTask', params);
    if (!result.ok) throw new Error(result.error);
    return series(data, title).find((t) => taskDate(data, t) === date)!;
}

async function setRepeat(data: DataController, task: DataObject, repeat: string) {
    return data.setProperty(task.id, 'repeat', repeat);
}

function fresh(data: DataController, task: DataObject) {
    return data.getObject(task.id)!;
}

function categoryNames(data: DataController, task: DataObject): string[] {
    const names: string[] = [];
    for (let id = task.parent; id;) {
        const p = data.getObject(id)!;
        if (p.type !== 'Category') break;
        names.unshift(String(p.properties.name));
        id = p.parent;
    }
    return names;
}

function setNow(year: number, month: number, day: number) {
    vi.setSystemTime(new Date(year, month - 1, day, 10, 0));
}

/**
 * Повторы задач Трекера
 */
describe('Tracker: repeats', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        setNow(2026, 3, 4); // среда, 4 марта 2026; горизонт — 30 апреля 2026
    });
    afterEach(() => vi.useRealTimers());

    /**
     * Включение повтора
     */
    describe('enabling', () => {
        /**
         * Проверяет, что повтор «каждую неделю» добавляет задачи через 7 дней до конца следующего месяца
         */
        it('repeats_everyWeek_adds7DaysUpToEndOfNextMonth', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');

            const result = await setRepeat(data, task, 'weekly');

            expect(result.ok).toBe(true);
            expect(dates(data, 'Планёрка')).toEqual([
                '2026-03-04',
                '2026-03-11',
                '2026-03-18',
                '2026-03-25',
                '2026-04-01',
                '2026-04-08',
                '2026-04-15',
                '2026-04-22',
                '2026-04-29',
            ]);
        });

        /**
         * Проверяет, что все задачи набора имеют общие идентификатор и вид повтора
         */
        it('repeats_allTasksOfSet_shareRepeatIdAndRepeatKind', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');

            await setRepeat(data, task, 'weekly');

            const repeatId = fresh(data, task).properties.repeatId;
            expect(typeof repeatId).toBe('string');
            expect(repeatId).not.toBe('');
            for (const t of series(data, 'Планёрка')) {
                expect(t.properties.repeatId).toBe(repeatId);
                expect(t.properties.repeat).toBe('weekly');
            }
        });

        /**
         * Проверяет, что повтор по будням пропускает субботу и воскресенье
         */
        it('repeats_everyWeekday_skipsSaturdayAndSunday', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Зарядка', '2026-03-04');

            await setRepeat(data, task, 'weekdays');

            const list = dates(data, 'Зарядка') as string[];
            // 4 марта (оригинал) + будни с 5 марта по 30 апреля: 19 в марте и 22 в апреле
            expect(list).toHaveLength(1 + 19 + 22);
            expect(list).toContain('2026-03-06'); // пятница
            expect(list).not.toContain('2026-03-07'); // суббота
            expect(list).not.toContain('2026-03-08'); // воскресенье
            expect(list).toContain('2026-03-09'); // понедельник
            expect(list.at(-1)).toBe('2026-04-30');
            for (const d of list) {
                const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
                expect([0, 6]).not.toContain(weekday);
            }
        });

        /**
         * Проверяет, что дни создаются по необходимости в нужных месяцах, а выходные получают тип выходного дня
         */
        it('repeats_created_createDaysOnDemandInRequiredMonthsWeekendDaysOfWeekendType', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Отчёт', '2026-03-04');

            await setRepeat(data, task, 'weekly');

            const april = series(data, 'Отчёт').find((t) => taskDate(data, t) === '2026-04-01')!;
            const day = data.getObject(april.parent!)!;
            expect(day.type).toBe('Day');
            expect(data.getObject(day.parent!)!.properties.date).toBe('2026-04-01');
            // Суббота: «каждую неделю» от субботы создаёт дни-выходные
            const saturday = await addTask(data, 'Уборка', '2026-03-07');
            await setRepeat(data, saturday, 'weekly');
            const next = series(data, 'Уборка')[1];
            expect(data.getObject(next.parent!)!.type).toBe('DayOff');
        });

        /**
         * Проверяет, что повтор «каждый месяц» добавляет месяц
         */
        it('repeats_everyMonth_addsMonth', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Аренда', '2026-03-04');

            await setRepeat(data, task, 'monthly');

            expect(dates(data, 'Аренда')).toEqual(['2026-03-04', '2026-04-04']);
        });

        /**
         * Проверяет, что повтор от 31 числа использует последний день короткого месяца
         */
        it('repeats_everyMonthFrom31st_usesLastDayOfShorterMonth', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Баланс', '2026-03-31');

            await setRepeat(data, task, 'monthly');

            expect(dates(data, 'Баланс')).toEqual(['2026-03-31', '2026-04-30']);
        });

        /**
         * Проверяет, что копируются свойства и цепочка категорий, но не статус
         */
        it('repeats_copiesPropertiesAndCategoryChainButNotStatus', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Созвон', '2026-03-04', 'Работа');
            await data.setProperty(task.id, 'time', '09:30');
            await data.setProperty(task.id, 'comment', 'Заметка');
            await data.setProperty(task.id, 'link', 'https://example.com');
            await data.setProperty(task.id, 'priority', 'high');
            await data.setProperty(task.id, 'notifyBefore', 15);

            await setRepeat(data, fresh(data, task), 'monthly');

            const copy = series(data, 'Созвон')[1];
            expect(copy.properties.name).toBe('09:30 — Созвон');
            expect(copy.properties.comment).toBe('Заметка');
            expect(copy.properties.link).toBe('https://example.com');
            expect(copy.properties.priority).toBe('high');
            expect(copy.properties.notifyBefore).toBe(15);
            expect(copy.properties.status).toBeUndefined();
            expect(copy.order).toBe(1 + 9 * 60 + 30);
            expect(categoryNames(data, copy)).toEqual(['Работа']);
        });

        /**
         * Проверяет, что копируется вложенная цепочка категорий
         */
        it('repeats_copiesNestedCategoryChain', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Отчёт', '2026-03-04', 'Работа');
            const inner = await data.create({
                type: 'Category',
                parent: task.parent!,
                properties: { name: 'Финансы' },
            });
            if (!inner.ok) throw new Error(inner.error);
            await data.move(task.id, { parent: inner.id });

            await setRepeat(data, fresh(data, task), 'monthly');

            expect(categoryNames(data, series(data, 'Отчёт')[1])).toEqual(['Работа', 'Финансы']);
        });

        /**
         * Проверяет, что выбор вида повтора идёт одним набором, а одна отмена возвращает всё
         */
        it('repeats_kindSelection_isOneChangesetAndOneUndoRevertsAll', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');

            const undone = await data.undo();

            expect(undone.ok).toBe(true);
            expect(series(data, 'Планёрка')).toHaveLength(1);
            expect(fresh(data, task).properties.repeat).toBe('none');
        });

        /**
         * Проверяет, что после 15 декабря горизонт заканчивается 31 января следующего года
         */
        it('repeats_horizon_after15DecemberEndsOn31JanuaryOfNextYear', async () => {
            setNow(2026, 12, 15);
            const { data } = await start();
            const task = await addTask(data, 'Итоги', '2026-12-15');

            await setRepeat(data, task, 'weekly');

            expect(dates(data, 'Итоги')).toEqual([
                '2026-12-15',
                '2026-12-22',
                '2026-12-29',
                '2027-01-05',
                '2027-01-12',
                '2027-01-19',
                '2027-01-26',
            ]);
        });

        /**
         * Проверяет, что горизонт от 31 января доходит до 28 февраля
         */
        it('repeats_horizonAtMonthEnd_31JanuaryUpTo28February', async () => {
            setNow(2026, 1, 31);
            const { data } = await start();
            const task = await addTask(data, 'Сводка', '2026-01-31');

            await setRepeat(data, task, 'weekly');

            expect(dates(data, 'Сводка')).toEqual([
                '2026-01-31',
                '2026-02-07',
                '2026-02-14',
                '2026-02-21',
                '2026-02-28',
            ]);
        });

        /**
         * Проверяет, что последний день горизонта включается, а следующий — нет
         */
        it('repeats_lastDayOfHorizon_isIncludedNextDayIsNot', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Граница', '2026-04-29');

            await setRepeat(data, task, 'weekdays');

            expect(dates(data, 'Граница')).toEqual(['2026-04-29', '2026-04-30']);
        });

        /**
         * Проверяет, что задача за горизонтом получает идентификатор, но повторов не создаёт
         */
        it('repeats_taskBeyondHorizon_getsIdButCreatesNoRepeats', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Далеко', '2026-06-10');

            const result = await setRepeat(data, task, 'weekly');

            expect(result.ok).toBe(true);
            expect(series(data, 'Далеко')).toHaveLength(1);
            expect(fresh(data, task).properties.repeatId).toBeTruthy();
        });

        /**
         * Проверяет, что прошедшие даты не создаются, а повторы начинаются с сегодняшнего дня
         */
        it('repeats_pastDates_areNotCreatedRepeatsStartFromToday', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Старая', '2026-02-18');

            await setRepeat(data, task, 'weekly');

            const list = dates(data, 'Старая') as string[];
            expect(list[0]).toBe('2026-02-18');
            expect(list.slice(1)[0]).toBe('2026-03-04');
            expect(list.at(-1)).toBe('2026-04-29');
        });
    });

    /**
     * Задача в выходном дне
     */
    describe('weekend day', () => {
        /**
         * Проверяет, что повтор по будням для задачи в выходном дне отклоняется с сообщением
         */
        it('repeats_everyWeekdayForTaskInWeekendDay_isRejectedWithMessage', async () => {
            const { data, api } = await start();
            const task = await addTask(data, 'Субботнее', '2026-03-07');
            const posted = api.changesets.length;

            const result = await setRepeat(data, task, 'weekdays');

            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error).toContain('выходн');
            expect(fresh(data, task).properties.repeat).toBe('none');
            expect(fresh(data, task).properties.repeatId).toBeUndefined();
            expect(series(data, 'Субботнее')).toHaveLength(1);
            expect(api.changesets).toHaveLength(posted);
        });

        /**
         * Проверяет, что для выходного дня разрешены повторы «каждую неделю» и «каждый месяц»
         */
        it('repeats_everyWeekAndEveryMonthForWeekendDay_areAllowed', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Субботнее', '2026-03-07');

            const result = await setRepeat(data, task, 'weekly');

            expect(result.ok).toBe(true);
            expect(dates(data, 'Субботнее')?.[1]).toBe('2026-03-14');
        });
    });

    /**
     * Синхронизация правок по набору повторов
     */
    describe('synchronization', () => {
        async function weekly(title = 'Планёрка') {
            const started = await start();
            const task = await addTask(started.data, title, '2026-03-04');
            await setRepeat(started.data, task, 'weekly');
            return { ...started, task };
        }

        /**
         * Проверяет, что правка свойства одного повтора распространяется на весь набор
         */
        it.each([
            ['title', 'Новая планёрка'],
            ['comment', 'Принести отчёт'],
            ['link', 'https://example.com/a'],
            ['priority', 'high'],
            ['time', '14:15'],
        ])('sync_changeOfProperty_%s_propagatesToWholeSet', async (property, value) => {
            const { data, task } = await weekly();
            const middle = series(data, 'Планёрка')[3];

            const result = await data.setProperty(middle.id, property, value);

            expect(result.ok).toBe(true);
            const members = allTasks(data).filter(
                (t) => t.properties.repeatId === fresh(data, task).properties.repeatId,
            );
            expect(members).toHaveLength(9);
            for (const m of members) expect(m.properties[property]).toBe(value);
        });

        /**
         * Проверяет, что правка названия обновляет вычисляемые имена, а правка времени — порядок у всех повторов
         */
        it('sync_nameChange_updatesComputedNamesAndTimeChangeUpdatesOrderForAll', async () => {
            const { data } = await weekly();
            const first = series(data, 'Планёрка')[0];

            await data.setProperty(first.id, 'time', '08:00');
            await data.setProperty(first.id, 'title', 'Встреча');

            const members = series(data, 'Встреча');
            expect(members).toHaveLength(9);
            for (const m of members) {
                expect(m.properties.name).toBe('08:00 — Встреча');
                expect(m.order).toBe(1 + 8 * 60);
            }
        });

        /**
         * Проверяет, что очистка комментария тоже распространяется на набор
         */
        it('sync_commentCleared_propagatesToo', async () => {
            const { data } = await weekly();
            const list = series(data, 'Планёрка');
            await data.setProperty(list[0].id, 'comment', 'Текст');

            await data.setProperty(list[2].id, 'comment', null);

            for (const m of series(data, 'Планёрка')) {
                expect(m.properties.comment).toBeUndefined();
            }
        });

        /**
         * Проверяет, что смена порядка внутри дня распространяется на набор
         */
        it('sync_orderChangeInsideDay_propagatesToSet', async () => {
            const { data } = await weekly();
            const list = series(data, 'Планёрка');

            const result = await data.move(list[1].id, { order: 7 });

            expect(result.ok).toBe(true);
            for (const m of series(data, 'Планёрка')) expect(m.order).toBe(7);
        });

        /**
         * Проверяет, что перенос в другой день не переносит остальные повторы
         */
        it('sync_moveToAnotherDay_doesNotMoveOtherRepeats', async () => {
            const { data } = await weekly();
            const list = series(data, 'Планёрка');
            const before = list.map((t) => t.parent);

            await data.runAction(list[1].id, 'postpone', { date: '2026-03-12' });

            const after = series(data, 'Планёрка');
            expect(after).toHaveLength(9);
            expect(dates(data, 'Планёрка')).toEqual([
                '2026-03-04',
                '2026-03-12',
                '2026-03-18',
                '2026-03-25',
                '2026-04-01',
                '2026-04-08',
                '2026-04-15',
                '2026-04-22',
                '2026-04-29',
            ]);
            expect(after[0].parent).toBe(before[0]);
            expect(after[2].parent).toBe(before[2]);
        });

        /**
         * Проверяет, что правка идёт одним набором и откатывается одной отменой
         */
        it('sync_edit_isOneChangesetAndRevertedByOneUndo', async () => {
            const { data, api } = await weekly();
            const posted = api.changesets.length;

            await data.setProperty(series(data, 'Планёрка')[2].id, 'priority', 'high');

            expect(api.changesets).toHaveLength(posted + 1);
            await data.undo();
            for (const m of series(data, 'Планёрка')) expect(m.properties.priority).toBe('low');
        });

        /**
         * Проверяет, что уведомление и внутренняя ссылка между повторами не синхронизируются
         */
        it('sync_editOfOtherProperties_notificationAndInternalLinkAreNotSynchronized', async () => {
            const { data } = await weekly();
            const list = series(data, 'Планёрка');

            await data.setProperty(list[0].id, 'notifyBefore', 30);

            expect(series(data, 'Планёрка')[1].properties.notifyBefore).toBeUndefined();
        });

        /**
         * Проверяет, что синхронизация не зацикливается и не трогает задачи без повтора
         */
        it('sync_noLoopAndTasksWithoutRepeatAreUntouched', async () => {
            const { data } = await weekly();
            const other = await addTask(data, 'Планёрка', '2026-03-05');

            const result = await data.setProperty(
                series(data, 'Планёрка')[0].id,
                'priority',
                'high',
            );

            expect(result.ok).toBe(true);
            expect(fresh(data, other).properties.priority).toBe('low');
        });

        /**
         * Проверяет, что отказ сервера откатывает правку у всего набора
         */
        it('sync_serverRejection_revertsEditForWholeSet', async () => {
            const { data, api } = await weekly();
            api.rejectNext(500, 'сбой');

            const result = await data.setProperty(
                series(data, 'Планёрка')[0].id,
                'priority',
                'high',
            );

            expect(result.ok).toBe(false);
            for (const m of series(data, 'Планёрка')) expect(m.properties.priority).toBe('low');
        });
    });

    /**
     * Смена вида повтора
     */
    describe('repeat kind change', () => {
        /**
         * Проверяет, что смена «каждую неделю» на «по будням» перестраивает набор с тем же идентификатором
         */
        it('kindChange_everyWeekToEveryWeekday_rebuildsSetWithSameId', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Задача', '2026-03-04');
            await setRepeat(data, task, 'weekly');
            const repeatId = fresh(data, task).properties.repeatId;

            const result = await setRepeat(data, fresh(data, task), 'weekdays');

            expect(result.ok).toBe(true);
            expect(series(data, 'Задача')).toHaveLength(1 + 19 + 22);
            for (const t of series(data, 'Задача')) {
                expect(t.properties.repeat).toBe('weekdays');
                expect(t.properties.repeatId).toBe(repeatId);
            }
        });
    });

    /**
     * Отключение повтора
     */
    describe('disabling', () => {
        /**
         * Проверяет, что отключение удаляет созданные повторы и очищает идентификатор повтора
         */
        it('disable_removesAllCreatedRepeatsAndClearsRepeatId', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04', 'Работа');
            await setRepeat(data, task, 'weekly');

            const result = await setRepeat(data, fresh(data, task), 'none');

            expect(result.ok).toBe(true);
            const left = series(data, 'Планёрка');
            expect(left.map((t) => t.id)).toEqual([task.id]);
            expect(left[0].properties.repeat).toBe('none');
            expect(left[0].properties.repeatId).toBeUndefined();
        });

        /**
         * Проверяет, что отключение у любого повтора оставляет именно эту задачу
         */
        it('disable_onAnyRepeat_keepsExactlyThatTask', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');
            const chosen = series(data, 'Планёрка')[4];

            await setRepeat(data, chosen, 'none');

            expect(series(data, 'Планёрка').map((t) => t.id)).toEqual([chosen.id]);
        });

        /**
         * Проверяет, что опустевшие категории удаляются вместе с повторами, а оригинал остаётся
         */
        it('disable_emptiedCategories_areRemovedWithRepeatsAndOriginalStays', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04', 'Работа');
            await setRepeat(data, task, 'weekly');

            await setRepeat(data, fresh(data, task), 'none');

            const categories: DataObject[] = [];
            const walk = (p: string | null) =>
                data.getChildren(p).forEach((o) => {
                    if (o.type === 'Category') categories.push(o);
                    walk(o.id);
                });
            walk(null);
            expect(categories).toHaveLength(1);
        });

        /**
         * Проверяет, что завершённые повторы в архиве остаются, но выходят из набора
         */
        it('disable_completedArchiveRepeats_areKeptButDetachedFromSet', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');
            const done = series(data, 'Планёрка')[1];
            await data.runAction(done.id, 'complete');

            await setRepeat(data, fresh(data, task), 'none');

            const left = series(data, 'Планёрка');
            expect(left).toHaveLength(2);
            expect(left.map((t) => t.id)).toContain(done.id);
            expect(fresh(data, done).properties.status).toBe('completed');
            expect(fresh(data, done).properties.repeatId).toBeUndefined();
            expect(fresh(data, done).properties.repeat).toBe('none');
        });

        /**
         * Проверяет, что после отключения достройка ничего не создаёт
         */
        it('disable_afterwards_topUpCreatesNothing', async () => {
            const { data, api } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');
            await setRepeat(data, fresh(data, task), 'none');
            const posted = api.changesets.length;

            await ensureRepeats(data);

            expect(api.changesets).toHaveLength(posted);
            expect(series(data, 'Планёрка')).toHaveLength(1);
        });
    });

    /**
     * Достройка повторов при входе
     */
    describe('top-up on login', () => {
        /**
         * Проверяет, что достройка добавляет недостающие повторы до нового горизонта
         */
        it('topUp_addsMissingRepeatsUpToNewHorizon', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');
            setNow(2026, 4, 2); // горизонт сдвинулся до 31 мая

            const result = await ensureRepeats(data);

            expect(result.ok).toBe(true);
            const list = dates(data, 'Планёрка') as string[];
            expect(list.slice(-5)).toEqual([
                '2026-04-29',
                '2026-05-06',
                '2026-05-13',
                '2026-05-20',
                '2026-05-27',
            ]);
            expect(new Set(list).size).toBe(list.length);
        });

        /**
         * Проверяет, что второй запуск не создаёт дублей и не отправляет изменений
         */
        it('topUp_secondRun_createsNoDuplicatesAndSendsNoChanges', async () => {
            const { data, api } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');
            setNow(2026, 4, 2);
            await ensureRepeats(data);
            const posted = api.changesets.length;
            const count = series(data, 'Планёрка').length;

            const again = await ensureRepeats(data);

            expect(again.ok).toBe(true);
            expect(series(data, 'Планёрка')).toHaveLength(count);
            expect(api.changesets).toHaveLength(posted);
        });

        /**
         * Проверяет, что сразу после включения достраивать нечего
         */
        it('topUp_justAfterEnabling_hasNothingToAdd', async () => {
            const { data, api } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');
            const posted = api.changesets.length;

            await ensureRepeats(data);

            expect(api.changesets).toHaveLength(posted);
        });

        /**
         * Проверяет, что повтор по будням достраивается без выходных
         */
        it('topUp_everyWeekday_isToppedUpWithoutWeekends', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Зарядка', '2026-03-04');
            await setRepeat(data, task, 'weekdays');
            setNow(2026, 5, 1); // горизонт — 30 июня

            await ensureRepeats(data);

            const list = dates(data, 'Зарядка') as string[];
            expect(list.at(-1)).toBe('2026-06-30');
            expect(new Set(list).size).toBe(list.length);
            for (const d of list) {
                expect([0, 6]).not.toContain(new Date(`${d}T00:00:00Z`).getUTCDay());
            }
            // Непрерывно по будням: после 30 апреля идёт 1 мая (пятница)
            expect(list).toContain('2026-05-01');
            expect(list).toContain('2026-05-04');
        });

        /**
         * Проверяет, что повтор по месяцам использует исходный день, а не укороченный
         */
        it('topUp_everyMonth_usesOriginalDayNotClamped', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Баланс', '2026-01-31');
            setNow(2026, 1, 31);
            await setRepeat(data, task, 'monthly');
            setNow(2026, 3, 31); // горизонт — 30 апреля

            await ensureRepeats(data);

            expect(dates(data, 'Баланс')).toEqual([
                '2026-01-31',
                '2026-02-28',
                '2026-03-31',
                '2026-04-30',
            ]);
        });

        /**
         * Проверяет, что набор без идентификатора и задачи без повтора игнорируются
         */
        it('topUp_setWithoutIdAndTasksWithoutRepeat_areIgnored', async () => {
            const { data, api } = await start();
            await addTask(data, 'Обычная', '2026-03-04');
            const posted = api.changesets.length;

            const result = await ensureRepeats(data);

            expect(result.ok).toBe(true);
            expect(api.changesets).toHaveLength(posted);
        });

        /**
         * Проверяет, что достройка нескольких наборов идёт одним набором изменений
         */
        it('topUp_severalSets_isOneChangeset', async () => {
            const { data, api } = await start();
            const a = await addTask(data, 'А', '2026-03-04');
            const b = await addTask(data, 'Б', '2026-03-05');
            await setRepeat(data, a, 'weekly');
            await setRepeat(data, b, 'weekly');
            setNow(2026, 4, 2);
            const posted = api.changesets.length;

            await ensureRepeats(data);

            expect(api.changesets).toHaveLength(posted + 1);
            expect((dates(data, 'А') as string[]).at(-1)).toBe('2026-05-27');
            expect((dates(data, 'Б') as string[]).at(-1)).toBe('2026-05-28');
        });

        /**
         * Проверяет, что достройка сохраняет цепочку категорий и свойства
         */
        it('topUp_keepsCategoryChainAndSameProperties', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04', 'Работа');
            await data.setProperty(task.id, 'time', '10:00');
            await setRepeat(data, fresh(data, task), 'weekly');
            setNow(2026, 4, 2);

            await ensureRepeats(data);

            const last = series(data, 'Планёрка').at(-1)!;
            expect(taskDate(data, last)).toBe('2026-05-27');
            expect(categoryNames(data, last)).toEqual(['Работа']);
            expect(last.properties.name).toBe('10:00 — Планёрка');
            expect(last.order).toBe(1 + 10 * 60);
        });
    });

    /**
     * Завершение и откладывание повторов
     */
    describe('Complete and Postpone', () => {
        /**
         * Проверяет, что завершённый повтор остаётся в наборе, а его дата не создаётся заново
         */
        it('completeAndPostpone_completedRepeat_staysInSetAndItsDateIsNotRecreated', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');
            const second = series(data, 'Планёрка')[1];
            await data.runAction(second.id, 'complete');
            setNow(2026, 4, 2);

            await ensureRepeats(data);

            const list = dates(data, 'Планёрка') as string[];
            expect(list.filter((d) => d === '2026-03-11')).toHaveLength(1);
            expect(new Set(list).size).toBe(list.length);
        });

        /**
         * Проверяет, что правка активного повтора доходит и до завершённого
         */
        it('completeAndPostpone_editOfActiveRepeat_reachesCompletedOne', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');
            const second = series(data, 'Планёрка')[1];
            await data.runAction(second.id, 'complete');

            await data.setProperty(task.id, 'priority', 'high');

            expect(fresh(data, second).properties.priority).toBe('high');
            expect(fresh(data, second).properties.status).toBe('completed');
        });

        /**
         * Проверяет, что статус «завершена» не распространяется на набор
         */
        it('completeAndPostpone_completedStatus_isNotPropagatedToSet', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');

            await data.runAction(task.id, 'complete');

            const pending = series(data, 'Планёрка').filter(
                (t) => t.properties.status !== 'completed',
            );
            expect(pending).toHaveLength(8);
        });

        /**
         * Проверяет, что повтор можно включить у завершённой задачи, а копии попадают в текущие задачи
         */
        it('completeAndPostpone_repeatCanBeEnabledOnCompletedTask_copiesGoToCurrentTasks', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await data.runAction(task.id, 'complete');

            await setRepeat(data, task, 'monthly');

            const copy = series(data, 'Планёрка')[1];
            expect(copy.properties.status).toBeUndefined();
            expect(taskDate(data, copy)).toBe('2026-04-04');
            const ancestor = (id: string | null): string => {
                const o = data.getObject(id!)!;
                return o.type === 'CurrentTasksRoot'
                    ? o.type
                    : o.parent
                      ? ancestor(o.parent)
                      : o.type;
            };
            expect(ancestor(copy.parent)).toBe('CurrentTasksRoot');
        });

        /**
         * Проверяет, что отложенный повтор не оставляет пропуска, который достроила бы достройка
         */
        it('completeAndPostpone_postponedRepeat_leavesNoGapForTopUpToRefill', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');
            const second = series(data, 'Планёрка')[1];
            await data.runAction(second.id, 'postpone', { date: '2026-03-13' });
            setNow(2026, 4, 2);

            await ensureRepeats(data);

            const list = dates(data, 'Планёрка') as string[];
            expect(list).not.toContain('2026-03-11');
            expect(list).toContain('2026-03-13');
            expect(new Set(list).size).toBe(list.length);
        });

        /**
         * Проверяет, что откладывание на дату существующего повтора не даёт дублей при достройке
         */
        it('completeAndPostpone_postponedToDateOfExistingRepeat_createsNoDuplicatesOnTopUp', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Планёрка', '2026-03-04');
            await setRepeat(data, task, 'weekly');
            await data.runAction(series(data, 'Планёрка')[0].id, 'postpone', {
                date: '2026-03-11',
            });
            const before = series(data, 'Планёрка').length;

            await ensureRepeats(data);

            expect(series(data, 'Планёрка')).toHaveLength(before);
        });
    });

    /**
     * Уведомления повторов
     */
    describe('notifications', () => {
        /**
         * Проверяет, что повтор со временем и упреждением уведомляет в свой день
         */
        it('notifications_repeatWithTimeAndLeadMinutes_firesOnItsDay', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Созвон', '2026-03-04');
            await data.setProperty(task.id, 'time', '10:00');
            await data.setProperty(task.id, 'notifyBefore', 10);
            await setRepeat(data, fresh(data, task), 'weekly');
            const copy = series(data, 'Созвон')[1];

            const next = new Date(2026, 2, 11, 9, 55);
            const { due } = checkNotifications(data, next, createNotificationState());

            expect(due.map((d) => d.taskId)).toEqual([copy.id]);
            expect(due[0].title).toBe('10:00');
        });

        /**
         * Проверяет, что повтор без времени не даёт уведомлений
         */
        it('notifications_repeatWithoutTime_createsNone', async () => {
            const { data } = await start();
            const task = await addTask(data, 'Без времени', '2026-03-04');
            await setRepeat(data, task, 'weekly');

            const next = new Date(2026, 2, 11, 12, 0);
            const { due } = checkNotifications(data, next, createNotificationState());

            expect(due).toEqual([]);
        });
    });
});
