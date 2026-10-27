import { describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureTasksStart, registerTasks } from './tasksExtension';

import type { CommandDefinition, TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

async function start() {
    const reveal = vi.fn();
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    registerTasks(data, { reveal });
    await ensureTasksStart(data);
    const tasksRoot = data.getChildren(null).find((o) => o.type === 'TasksRoot')!;
    const current = data.getChildren(tasksRoot.id).find((o) => o.type === 'CurrentTasksRoot')!;
    return { api, data, reveal, current };
}

/**
 * Фиксирует «сейчас» (местное время) на время теста
 */
async function atDate(year: number, month: number, day: number, body: () => Promise<void>) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(year, month - 1, day, 12, 0));
    try {
        await body();
    } finally {
        vi.useRealTimers();
    }
}

const command = manifest.commands.find((c) => c.id === 'selectToday') as CommandDefinition;

/**
 * Команда «Выделить текущий день»
 */
describe('Tracker: "Select today" command', () => {
    /**
     * Проверяет, что команда описана в манифесте, а механизма и действия в автоматизации больше нет
     */
    it('selectToday_manifest_hasCommandAndNoMechanismType', () => {
        expect(command.name).toBe('Выделить текущий день');
        expect(command.icon).toBe('crosshair');
        expect(types.some((t) => t.id === 'SelectTodayMechanism')).toBe(false);
    });

    /**
     * Проверяет, что обработчик зарегистрирован и стартовая настройка не создаёт скрытых объектов
     */
    it('selectToday_startSetup_registersHandlerAndCreatesOnlyTasksRoot', async () => {
        const { data } = await start();

        expect(data.isCommandAvailable('selectToday')).toBe(true);
        expect(data.getChildren(null).map((o) => o.type)).toEqual(['TasksRoot']);
    });

    /**
     * Проверяет, что команда выделяет день с сегодняшней датой
     */
    it('selectToday_command_selectsDayWithTodaysDate', async () => {
        await atDate(2026, 6, 10, async () => {
            const { data, reveal, current } = await start();
            await data.runAction(current.id, 'createTask', { title: 'Вчера', date: '2026-06-09' });
            await data.runAction(current.id, 'createTask', {
                title: 'Сегодня',
                date: '2026-06-10',
            });
            const month = data.getChildren(current.id)[0];
            const day = data.getChildren(month.id).find((d) => d.properties.date === '2026-06-10')!;

            const result = await data.runCommand(command);

            expect(result.ok).toBe(true);
            expect(reveal).toHaveBeenCalledTimes(1);
            expect(reveal).toHaveBeenCalledWith(day.id);
        });
    });

    /**
     * Проверяет, что команда выделяет и выходной день
     */
    it('selectToday_command_selectsWeekendDayToo', async () => {
        await atDate(2026, 6, 13, async () => {
            const { data, reveal, current } = await start();
            await data.runAction(current.id, 'createTask', { title: 'Т', date: '2026-06-13' });
            const day = data.getChildren(data.getChildren(current.id)[0].id)[0];
            expect(day.type).toBe('DayOff');

            await data.runCommand(command);

            expect(reveal).toHaveBeenCalledWith(day.id);
        });
    });

    /**
     * Проверяет, что при отсутствии дня на сегодня возвращается сообщение, объекты не создаются и ничего не выделяется
     */
    it('selectToday_noDayForToday_returnsMessageCreatesNoObjectsSelectsNothing', async () => {
        await atDate(2026, 6, 10, async () => {
            const { api, data, reveal, current } = await start();
            await data.runAction(current.id, 'createTask', { title: 'Вчера', date: '2026-06-09' });
            const sentBefore = api.changesets.length;
            const countBefore = data.getChildren(data.getChildren(current.id)[0].id).length;

            const result = await data.runCommand(command);

            expect(result).toEqual({
                ok: false,
                error: 'На сегодня в «Текущих задачах» ещё нет дня.',
            });
            expect(reveal).not.toHaveBeenCalled();
            expect(api.changesets).toHaveLength(sentBefore);
            expect(data.getChildren(data.getChildren(current.id)[0].id)).toHaveLength(countBefore);
        });
    });
});
