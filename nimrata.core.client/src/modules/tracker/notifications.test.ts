import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform';
import type { DataController, TypeDefinition } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import {
    checkNotifications,
    createNotificationState,
    startNotificationService,
} from './notifications';
import { ensureStartStructure, registerTracker } from './tracker';

const types = manifest.types.map((t) => ({
    ...t,
    module: manifest.module,
    moduleVersion: manifest.version,
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

/** Создаёт задачу на дату и задаёт ей свойства; возвращает идентификатор. */
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

describe('Трекер: расчёт уведомлений', () => {
    it('задача без времени уведомлений не создаёт', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Без времени');

        const { due } = checkNotifications(data, at(23, 0), createNotificationState());

        expect(due).toEqual([]);
    });

    it('без «за N минут» уведомляет ровно в назначенное время: заголовок «HH:mm», тело — название', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Позвонить', { time: '09:30' });

        expect(checkNotifications(data, at(9, 29), createNotificationState()).due).toEqual([]);
        const { due } = checkNotifications(data, at(9, 30), createNotificationState());

        expect(due.map((d) => [d.title, d.body])).toEqual([['09:30', 'Позвонить']]);
    });

    it('с «за N минут» уведомляет за N минут до времени', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Встреча', { time: '10:00', notifyBefore: 15 });

        expect(checkNotifications(data, at(9, 44), createNotificationState()).due).toEqual([]);
        const { due } = checkNotifications(data, at(9, 45), createNotificationState());

        expect(due.map((d) => [d.title, d.body])).toEqual([['10:00', 'Встреча']]);
    });

    it('завершённая задача не уведомляет', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Готово', { time: '09:00', status: 'completed' });

        expect(checkNotifications(data, at(9, 0), createNotificationState()).due).toEqual([]);
    });

    it('уже показанное повторно не показывается', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Раз', { time: '09:00' });

        const first = checkNotifications(data, at(9, 0), createNotificationState());
        const second = checkNotifications(data, at(9, 1), first.state);

        expect(first.due).toHaveLength(1);
        expect(second.due).toEqual([]);
    });

    it('задачи других дней не уведомляют', async () => {
        const data = await start();
        await addTask(data, '2026-03-05', 'Завтра', { time: '09:00' });
        await addTask(data, '2026-03-03', 'Вчера', { time: '09:00' });

        expect(checkNotifications(data, at(9, 0), createNotificationState()).due).toEqual([]);
    });

    it('давно прошедшее время (больше часа назад) не уведомляет при входе позже', async () => {
        const data = await start();
        await addTask(data, '2026-03-04', 'Утром', { time: '09:00' });

        expect(checkNotifications(data, at(15, 0), createNotificationState()).due).toEqual([]);
    });

    it('смена суток: показанное вчера не мешает новым суткам, уведомляются задачи нового дня', async () => {
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

describe('Трекер: служба уведомлений', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());

    it('проверяет сразу и раз в минуту, показывает задачу один раз; stop останавливает таймер', async () => {
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

    it('подхватывает задачу, добавленную после запуска', async () => {
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
});
