import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform';
import { createFakeApi, whenSynced } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { taskDate } from './tasks';
import { ensureTasksStart, registerTasks } from './tasksExtension';

import type { CommandDefinition, DataController, DataObject, TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

const command = manifest.commands.find((c) => c.id === 'createSchedule') as CommandDefinition;

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

/**
 * Все дни (обычные и выходные) корня с их типом, по возрастанию даты
 */
function days(data: DataController, type = 'CurrentTasksRoot'): DataObject[] {
    const result: DataObject[] = [];
    const walk = (parent: string) =>
        data.getChildren(parent).forEach((o) => {
            if (o.type === 'Day' || o.type === 'DayOff') result.push(o);
            else walk(o.id);
        });
    walk(root(data, type).id);
    return result.sort((a, b) =>
        String(a.properties.date).localeCompare(String(b.properties.date)),
    );
}

function months(data: DataController, type = 'CurrentTasksRoot') {
    return data.getChildren(root(data, type).id).filter((o) => o.type === 'Month');
}

function tasks(data: DataController, title: string): string[] {
    const list: DataObject[] = [];
    const walk = (parent: string | null) =>
        data.getChildren(parent).forEach((o) => {
            if (o.type === 'Task' && o.properties.name === title) list.push(o);
            walk(o.id);
        });
    walk(null);
    return list.map((t) => taskDate(data, t)!).sort();
}

const run = (data: DataController, params: Record<string, unknown>) =>
    data.runCommand(command, params);

/**
 * Команда «Создать расписание»
 */
describe('Tracker: "Create schedule" command', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 2, 4, 10, 0)); // среда, 4 марта 2026
    });
    afterEach(() => vi.useRealTimers());

    /**
     * Проверяет описание команды в манифесте
     */
    it('createSchedule_manifest_hasCommandWithStartAndEndDateParameters', () => {
        expect(command.name).toBe('Создать расписание');
        expect(command.parameters!.map((p) => [p.id, p.kind, p.name])).toEqual([
            ['start', 'date', 'Начало'],
            ['end', 'date', 'Конец'],
        ]);
    });

    /**
     * Проверяет, что обработчик зарегистрирован
     */
    it('createSchedule_registered_isAvailable', async () => {
        const { data } = await start();

        expect(data.isCommandAvailable('createSchedule')).toBe(true);
    });

    /**
     * Проверяет создание месяцев и дней периода, выходных отдельным типом
     */
    it('createSchedule_period_createsMonthsAndDaysWithWeekendsAsDayOff', async () => {
        const { data } = await start();

        const result = await run(data, { start: '2026-03-27', end: '2026-04-02' });

        expect(result.ok).toBe(true);
        expect(months(data).map((m) => m.properties.date)).toEqual(['2026-03-01', '2026-04-01']);
        expect(days(data).map((d) => [d.properties.date, d.type])).toEqual([
            ['2026-03-27', 'Day'],
            ['2026-03-28', 'DayOff'],
            ['2026-03-29', 'DayOff'],
            ['2026-03-30', 'Day'],
            ['2026-03-31', 'Day'],
            ['2026-04-01', 'Day'],
            ['2026-04-02', 'Day'],
        ]);
        expect(days(data, 'CompletedTasksRoot')).toEqual([]);
    });

    /**
     * Проверяет, что параметры по умолчанию — сегодня и конец года
     */
    it('createSchedule_noParams_fromTodayToEndOfYear', async () => {
        const { data } = await start();

        const result = await run(data, {});

        expect(result.ok).toBe(true);
        const list = days(data);
        expect(list[0].properties.date).toBe('2026-03-04');
        expect(list.at(-1)!.properties.date).toBe('2026-12-31');
        expect(list).toHaveLength(303);
    });

    /**
     * Проверяет границы периода: один день, ровно максимальный период и превышение
     */
    it('createSchedule_periodBounds_oneDayAndMaxAllowedOverMaxRejected', async () => {
        const { data } = await start();

        expect((await run(data, { start: '2026-03-04', end: '2026-03-04' })).ok).toBe(true);
        expect(days(data)).toHaveLength(1);

        const max = await run(data, { start: '2026-03-04', end: '2027-03-04' });
        expect(max.ok).toBe(true);

        const over = await run(data, { start: '2026-03-04', end: '2027-03-05' });
        expect(over).toEqual({ ok: false, error: 'Период не может быть больше 365 дней.' });
    });

    /**
     * Проверяет ошибку, когда начало позже конца; ничего не создаётся
     */
    it('createSchedule_startAfterEnd_returnsErrorCreatesNothing', async () => {
        const { api, data } = await start();
        await whenSynced(data);
        const sent = api.changesets.length;

        const result = await run(data, { start: '2026-03-10', end: '2026-03-09' });

        expect(result).toEqual({ ok: false, error: 'Начало не может быть позже конца.' });
        expect(days(data)).toEqual([]);
        await whenSynced(data);
        expect(api.changesets).toHaveLength(sent);
    });

    /**
     * Проверяет ошибку неверной даты
     */
    it('createSchedule_invalidDate_returnsError', async () => {
        const { data } = await start();

        const result = await run(data, { start: '2026-02-30' });

        expect(result.ok).toBe(false);
    });

    /**
     * Проверяет, что весь период создаётся одним набором изменений и откатывается одной отменой
     */
    it('createSchedule_run_isOneChangesetAndOneUndoRevertsAll', async () => {
        const { api, data } = await start();
        await whenSynced(data);
        const sent = api.changesets.length;

        await run(data, { start: '2026-03-04', end: '2026-05-10' });
        await whenSynced(data);
        expect(api.changesets).toHaveLength(sent + 1);

        await data.undo();

        expect(days(data)).toEqual([]);
        expect(months(data)).toEqual([]);
    });

    /**
     * Проверяет идемпотентность: повторный запуск и перекрывающийся период дублей не создают
     */
    it('createSchedule_secondRun_createsNoDuplicatesAndSendsNothing', async () => {
        const { api, data } = await start();
        await run(data, { start: '2026-03-04', end: '2026-04-15' });
        await whenSynced(data);
        const sent = api.changesets.length;
        const before = days(data).length;

        const again = await run(data, { start: '2026-03-04', end: '2026-04-15' });

        expect(again.ok).toBe(true);
        await whenSynced(data);
        expect(api.changesets).toHaveLength(sent);
        expect(days(data)).toHaveLength(before);

        await run(data, { start: '2026-04-10', end: '2026-04-20' });

        const dates = days(data).map((d) => d.properties.date);
        expect(new Set(dates).size).toBe(dates.length);
        expect(dates.at(-1)).toBe('2026-04-20');
        expect(months(data)).toHaveLength(2);
    });

    /**
     * Проверяет, что уже созданные «по требованию» дни не дублируются и остаются
     */
    it('createSchedule_existingDayWithTask_isKeptAndNotDuplicated', async () => {
        const { data } = await start();
        await data.runAction(root(data, 'CurrentTasksRoot').id, 'createTask', {
            name: 'Раньше',
            date: '2026-03-20',
        });

        await run(data, { start: '2026-03-18', end: '2026-03-22' });

        expect(days(data).map((d) => d.properties.date)).toEqual([
            '2026-03-18',
            '2026-03-19',
            '2026-03-20',
            '2026-03-21',
            '2026-03-22',
        ]);
        expect(tasks(data, 'Раньше')).toEqual(['2026-03-20']);
    });

    /**
     * Проверяет, что без группы «Текущие задачи» возвращается ошибка
     */
    it('createSchedule_noCurrentTasksRoot_returnsError', async () => {
        const api = createFakeApi(types, []);
        const data = createDataController({ api });
        await data.load();
        registerTasks(data);

        const result = await run(data, {});

        expect(result).toEqual({ ok: false, error: 'Не найдена группа «Текущие задачи».' });
    });

    /**
     * Повторы: период достраивается целиком, горизонт — максимум из конца следующего месяца и последнего дня
     */
    describe('repeats', () => {
        async function withRepeat(data: DataController, kind: string, date = '2026-03-04') {
            await data.runAction(root(data, 'CurrentTasksRoot').id, 'createTask', {
                name: 'Повтор',
                date,
            });
            const object = findTask(data, 'Повтор');
            await data.setProperty(object.id, 'repeat', kind);
        }

        function findTask(data: DataController, title: string) {
            let found: DataObject | undefined;
            const walk = (parent: string | null) =>
                data.getChildren(parent).forEach((o) => {
                    if (o.type === 'Task' && o.properties.name === title && !found) found = o;
                    walk(o.id);
                });
            walk(null);
            return found!;
        }

        /**
         * Проверяет, что повтор по неделям заполняется на весь период, дальше горизонта по умолчанию
         */
        it('createSchedule_weeklyRepeat_fillsWholePeriodBeyondDefaultHorizon', async () => {
            const { data } = await start();
            await withRepeat(data, 'weekly');
            expect(tasks(data, 'Повтор').at(-1)).toBe('2026-04-29'); // горизонт — 30 апреля

            await run(data, { start: '2026-03-04', end: '2026-07-31' });

            const list = tasks(data, 'Повтор');
            expect(list.at(-1)).toBe('2026-07-29');
            expect(list).toHaveLength(22);
            expect(new Set(list).size).toBe(list.length);
        });

        /**
         * Проверяет, что повтор по будням пропускает выходные
         */
        it('createSchedule_weekdayRepeat_skipsWeekendsAndFillsPeriod', async () => {
            const { data } = await start();
            await withRepeat(data, 'weekdays');

            await run(data, { start: '2026-03-04', end: '2026-06-30' });

            const list = tasks(data, 'Повтор');
            expect(list.at(-1)).toBe('2026-06-30');
            for (const date of list) {
                const dayType = days(data).find((d) => d.properties.date === date)!.type;
                expect(dayType).toBe('Day');
            }
            expect(list).toHaveLength(85);
        });

        /**
         * Проверяет, что повтор по месяцам заполняется до конца периода
         */
        it('createSchedule_monthlyRepeat_fillsMonthsOfPeriod', async () => {
            const { data } = await start();
            await withRepeat(data, 'monthly');

            await run(data, { start: '2026-03-04', end: '2026-09-30' });

            expect(tasks(data, 'Повтор')).toEqual([
                '2026-03-04',
                '2026-04-04',
                '2026-05-04',
                '2026-06-04',
                '2026-07-04',
                '2026-08-04',
                '2026-09-04',
            ]);
        });

        /**
         * Проверяет, что период короче горизонта повторы не урезает: горизонт — не меньше конца следующего месяца
         */
        it('createSchedule_shortPeriod_keepsDefaultHorizonForRepeats', async () => {
            const { data } = await start();
            await withRepeat(data, 'weekly');
            const before = tasks(data, 'Повтор');

            await run(data, { start: '2026-03-04', end: '2026-03-10' });

            expect(tasks(data, 'Повтор')).toEqual(before);
        });

        /**
         * Проверяет, что горизонт учитывает последний существующий день, если он позже периода
         */
        it('createSchedule_existingLaterDay_extendsHorizonToLastExistingDay', async () => {
            const { data } = await start();
            await withRepeat(data, 'weekly');
            await data.runAction(root(data, 'CurrentTasksRoot').id, 'createTask', {
                name: 'Далеко',
                date: '2026-06-20',
            });

            await run(data, { start: '2026-03-04', end: '2026-03-10' });

            expect(tasks(data, 'Повтор').at(-1)).toBe('2026-06-17');
        });

        /**
         * Проверяет, что повторный запуск не плодит повторы, и всё идёт одним набором изменений
         */
        it('createSchedule_repeatsSecondRun_createsNoDuplicatesAndSendsNothing', async () => {
            const { api, data } = await start();
            await withRepeat(data, 'weekly');
            await run(data, { start: '2026-03-04', end: '2026-07-31' });
            await whenSynced(data);
            const sent = api.changesets.length;
            const before = tasks(data, 'Повтор');

            await run(data, { start: '2026-03-04', end: '2026-07-31' });

            await whenSynced(data);
            expect(api.changesets).toHaveLength(sent);
            expect(tasks(data, 'Повтор')).toEqual(before);
        });

        /**
         * Проверяет период в будущем: повторы достраиваются до его конца без пропусков, повторный запуск ничего не меняет
         */
        it('createSchedule_futurePeriod_fillsRepeatsToItsEndWithoutDuplicates', async () => {
            const { api, data } = await start();
            await withRepeat(data, 'weekly');

            await run(data, { start: '2026-06-01', end: '2026-07-31' });

            const list = tasks(data, 'Повтор');
            expect(list.at(-1)).toBe('2026-07-29');
            expect(list).toHaveLength(22);
            expect(new Set(list).size).toBe(list.length);

            await whenSynced(data);
            const sent = api.changesets.length;
            await run(data, { start: '2026-06-01', end: '2026-07-31' });

            await whenSynced(data);
            expect(api.changesets).toHaveLength(sent);
            expect(tasks(data, 'Повтор')).toEqual(list);
        });

        /**
         * Проверяет, что дни создаются и повторы достраиваются одним набором изменений
         */
        it('createSchedule_daysAndRepeats_areOneChangeset', async () => {
            const { api, data } = await start();
            await withRepeat(data, 'weekly');
            await whenSynced(data);
            const sent = api.changesets.length;

            await run(data, { start: '2026-03-04', end: '2026-07-31' });

            await whenSynced(data);
            expect(api.changesets).toHaveLength(sent + 1);
        });
    });
});
