import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import {
    checkNotifications,
    createLocalShownStore,
    createNotificationState,
    startNotificationService,
} from './notifications';
import { ensureStartStructure, registerTracker } from './tracker';

import type { DataController, TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

async function start() {
    const data = createDataController({ api: createFakeApi(types, []) });
    await data.load();
    registerTracker(data);
    await ensureStartStructure(data);
    return data;
}

function current(data: DataController) {
    return data
        .getChildren(null)
        .flatMap((o) => data.getChildren(o.id))
        .find((o) => o.type === 'CurrentTasksRoot')!;
}

/**
 * Создаёт задачу на дату и задаёт ей свойства; возвращает идентификатор
 */
async function addTask(
    data: DataController,
    date: string,
    title: string,
    props: Record<string, unknown> = {},
) {
    const before = new Set(allIds(data));
    const result = await data.runAction(current(data).id, 'createTask', { title, date });
    if (!result.ok) throw new Error(result.error);
    const id = allIds(data).find((i) => !before.has(i) && data.getObject(i)!.type === 'Task')!;
    for (const [property, value] of Object.entries(props)) {
        const set = await data.setProperty(id, property, value);
        if (!set.ok) throw new Error(set.error);
    }
    return id;
}

function allIds(data: DataController): string[] {
    const ids: string[] = [];
    const walk = (parent: string | null) => {
        for (const o of data.getChildren(parent)) {
            ids.push(o.id);
            walk(o.id);
        }
    };
    walk(null);
    return ids;
}

const at = (h: number, m: number, day = 4) => new Date(2026, 2, day, h, m); // март 2026

/**
 * Расчёт уведомлений Трекера
 */
describe('Tracker: notifications calculation', () => {
    /**
     * Проверяет, что задача без времени не даёт уведомлений
     */
    it('notifications_taskWithoutTime_createsNone', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Без времени');

        const { due } = checkNotifications(data, at(23, 0), createNotificationState());

        expect(due).toEqual([]);
    });

    /**
     * Проверяет, что без упреждения уведомление приходит точно в назначенное время
     */
    it('notifications_withoutLeadMinutes_notifiesExactlyAtScheduledTime', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Позвонить', { time: '09:30' });

        expect(checkNotifications(data, at(9, 29), createNotificationState()).due).toEqual([]);
        const { due } = checkNotifications(data, at(9, 30), createNotificationState());

        expect(due.map((d) => [d.title, d.body])).toEqual([['09:30', 'Позвонить']]);
    });

    /**
     * Проверяет, что с упреждением уведомление приходит раньше на заданное число минут
     */
    it('notifications_withLeadMinutes_notifiesEarlierByThatMany', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Встреча', { time: '10:00', notifyBefore: 15 });

        expect(checkNotifications(data, at(9, 44), createNotificationState()).due).toEqual([]);
        const { due } = checkNotifications(data, at(9, 45), createNotificationState());

        expect(due.map((d) => [d.title, d.body])).toEqual([['10:00', 'Встреча']]);
    });

    /**
     * Проверяет, что завершённая задача не уведомляет
     */
    it('notifications_completedTask_doesNotNotify', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Готово', { time: '09:00', status: 'completed' });

        expect(checkNotifications(data, at(9, 0), createNotificationState()).due).toEqual([]);
    });

    /**
     * Проверяет, что уже показанное уведомление не показывается повторно
     */
    it('notifications_alreadyShown_isNotShownAgain', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Раз', { time: '09:00' });

        const first = checkNotifications(data, at(9, 0), createNotificationState());
        const second = checkNotifications(data, at(9, 1), first.state);

        expect(first.due).toHaveLength(1);
        expect(second.due).toEqual([]);
    });

    /**
     * Проверяет, что задачи других дней не уведомляют
     */
    it('notifications_tasksOfOtherDays_doNotNotify', async () => {
        const data = await start();
        await addTask(data, '2026-03-05', 'Завтра', { time: '09:00' });
        await addTask(data, '2026-03-03', 'Вчера', { time: '09:00' });

        expect(checkNotifications(data, at(9, 0), createNotificationState()).due).toEqual([]);
    });

    /**
     * Проверяет, что давно прошедшее время не уведомляет при позднем входе
     */
    it('notifications_longPastTime_doesNotNotifyOnLateLogin', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Утром', { time: '09:00' });

        expect(checkNotifications(data, at(15, 0), createNotificationState()).due).toEqual([]);
    });

    /**
     * Проверяет, что показанное вчера не мешает уведомлениям нового дня
     */
    it('notifications_dayChange_yesterdayShownDoesNotBlockNewDay', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Вечером', { time: '23:50' });
        await addTask(data, '2026-03-05', 'Ночью', { time: '00:00' });

        const evening = checkNotifications(data, at(23, 50), createNotificationState());
        const night = checkNotifications(data, at(0, 0, 5), evening.state);

        expect(evening.due.map((d) => d.body)).toEqual(['Вечером']);
        expect(night.due.map((d) => d.body)).toEqual(['Ночью']);
        expect(night.state.date).toBe('2026-03-05');
    });
});

/**
 * Служба уведомлений Трекера
 */
describe('Tracker: notification service', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());

    /**
     * Проверяет, что запуск проверяет сразу и каждую минуту, показывает задачу один раз, а остановка гасит таймер
     */
    it('notificationService_start_checksImmediatelyAndEveryMinuteShowsTaskOnceStopHaltsTimer', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Таймер', { time: '09:02' });
        let now = at(9, 0);
        const notify = vi.fn();

        const stop = startNotificationService({ data, now: () => now, notify });
        expect(notify).not.toHaveBeenCalled();

        now = at(9, 1);
        vi.advanceTimersByTime(60_000);
        expect(notify).not.toHaveBeenCalled();

        now = at(9, 2);
        vi.advanceTimersByTime(60_000);
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledWith('09:02', 'Таймер');

        now = at(9, 3);
        vi.advanceTimersByTime(60_000);
        expect(notify).toHaveBeenCalledTimes(1);

        stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    /**
     * Проверяет, что задача, добавленная после запуска, подхватывается
     */
    it('notificationService_taskAddedAfterStart_isPickedUp', async () => {
        const data = await start();
        let now = at(9, 0);
        const notify = vi.fn();
        const stop = startNotificationService({ data, now: () => now, notify });

        await addTask(data, '2026-03-04', 'Новая', { time: '09:01' });
        now = at(9, 1);
        vi.advanceTimersByTime(60_000);

        expect(notify).toHaveBeenCalledWith('09:01', 'Новая');
        stop();
    });

    /**
     * Запоминание показанных за день уведомлений
     */
    describe('persisting shown notifications per day', () => {
        beforeEach(() => localStorage.clear());
        afterEach(() => vi.restoreAllMocks());

        async function run(store: ReturnType<typeof createLocalShownStore>, nowAt = at(9, 0)) {
            const data = await start();
            const id = await addTask(data, '2026-03-04', 'Созвон', { time: '09:00' });
            const notify = vi.fn();
            const stop = startNotificationService({ data, now: () => nowAt, notify, store });
            stop();
            return { notify, id };
        }

        /**
         * Проверяет, что после перезагрузки страницы показанное не дублируется
         */
        it('shownNotifications_afterPageReload_isNotDuplicated', async () => {
            const data = await start();
            await addTask(data, '2026-03-04', 'Созвон', { time: '09:00' });
            const first = vi.fn();
            const second = vi.fn();

            startNotificationService({
                data,
                now: () => at(9, 0),
                notify: first,
                store: createLocalShownStore('u1'),
            })();
            // Перезагрузка страницы: новая служба с пустой памятью, то же хранилище
            startNotificationService({
                data,
                now: () => at(9, 5),
                notify: second,
                store: createLocalShownStore('u1'),
            })();

            expect(first).toHaveBeenCalledTimes(1);
            expect(second).not.toHaveBeenCalled();
        });

        /**
         * Проверяет, что показанное хранится в `localStorage` по ключу пользователя и даты
         */
        it('shownNotifications_stored_inLocalStorageByUserAndDateKey', async () => {
            const { id } = await run(createLocalShownStore('u1'));

            const raw = localStorage.getItem('nimrata.tracker.notifications.u1.2026-03-04');
            expect(JSON.parse(raw!)).toEqual([id]);
        });

        /**
         * Проверяет, что записи другого пользователя или другого дня игнорируются
         */
        it('shownNotifications_shownByOtherUserOrOtherDay_isIgnored', async () => {
            const data = await start();
            const id = await addTask(data, '2026-03-04', 'Созвон', { time: '09:00' });
            localStorage.setItem(
                'nimrata.tracker.notifications.u2.2026-03-04',
                JSON.stringify([id]),
            );
            localStorage.setItem(
                'nimrata.tracker.notifications.u1.2026-03-03',
                JSON.stringify([id]),
            );
            const notify = vi.fn();

            const stop = startNotificationService({
                data,
                now: () => at(9, 0),
                notify,
                store: createLocalShownStore('u1'),
            });
            stop();

            expect(notify).toHaveBeenCalledTimes(1);
        });

        /**
         * Проверяет, что записи прошлых дней этого пользователя удаляются
         */
        it('shownNotifications_pastDaysOfThisUser_areRemoved', async () => {
            localStorage.setItem('nimrata.tracker.notifications.u1.2026-03-03', '["x"]');
            localStorage.setItem('nimrata.tracker.notifications.u2.2026-03-03', '["x"]');

            await run(createLocalShownStore('u1'));

            expect(localStorage.getItem('nimrata.tracker.notifications.u1.2026-03-03')).toBeNull();
            expect(
                localStorage.getItem('nimrata.tracker.notifications.u2.2026-03-03'),
            ).not.toBeNull();
        });

        /**
         * Проверяет, что недоступное хранилище и мусор в нём не ломают службу
         */
        it('shownNotifications_unavailableStorageAndGarbage_doNotBreakService', async () => {
            localStorage.setItem('nimrata.tracker.notifications.u1.2026-03-04', '{не json');
            const garbage = await run(createLocalShownStore('u1'));
            expect(garbage.notify).toHaveBeenCalledTimes(1);

            vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('недоступно');
            });
            vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new Error('недоступно');
            });
            const broken = await run(createLocalShownStore('u1'));
            expect(broken.notify).toHaveBeenCalledTimes(1);
        });
    });
});
