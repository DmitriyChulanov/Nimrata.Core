import { describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureStartStructure, registerTracker } from './tracker';

import type { TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    module: manifest.module,
    moduleVersion: manifest.version,
})) as TypeDefinition[];

const MECHANISM = 'SelectTodayMechanism';

async function start() {
    const reveal = vi.fn();
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    registerTracker(data, { reveal });
    await ensureStartStructure(data);
    const mechanisms = () => data.getChildren(null).filter((o) => o.type === MECHANISM);
    const tasksRoot = data.getChildren(null).find((o) => o.type === 'TasksRoot')!;
    const current = data.getChildren(tasksRoot.id).find((o) => o.type === 'CurrentTasksRoot')!;
    return { api, data, reveal, mechanisms, current };
}

/** Фиксирует «сейчас» (местное время) на время теста */
async function atDate(year: number, month: number, day: number, body: () => Promise<void>) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(year, month - 1, day, 12, 0));
    try {
        await body();
    } finally {
        vi.useRealTimers();
    }
}

describe('Tracker: "Select today"', () => {
    it('selectToday_type_isAutomationMechanismHiddenInTreeWithActionInAutomation', () => {
        const type = types.find((t) => t.id === MECHANISM)!;
        expect(type.automation).toBe(true);
        expect(type.hiddenInTree).toBe(true);
        expect(type.actions?.find((a) => a.id === 'selectToday')?.placements).toContain(
            'automation',
        );
    });

    it('selectToday_startSetup_createsSingleMechanismWithoutDuplicates', async () => {
        const { data, mechanisms } = await start();
        expect(mechanisms()).toHaveLength(1);

        await ensureStartStructure(data);

        expect(mechanisms()).toHaveLength(1);
    });

    it('selectToday_userWithStructureButNoMechanism_getsItOnNextLogin', async () => {
        const { data, mechanisms } = await start();
        await data.perform((tx) => {
            const result = tx.remove(mechanisms()[0].id);
            if (!result.ok) throw new Error(result.error);
        });
        expect(mechanisms()).toHaveLength(0);

        const result = await ensureStartStructure(data);

        expect(result.ok).toBe(true);
        expect(mechanisms()).toHaveLength(1);
    });

    it('selectToday_action_selectsDayWithTodaysDate', async () => {
        await atDate(2026, 6, 10, async () => {
            const { data, reveal, mechanisms, current } = await start();
            await data.runAction(current.id, 'createTask', { title: 'Вчера', date: '2026-06-09' });
            await data.runAction(current.id, 'createTask', {
                title: 'Сегодня',
                date: '2026-06-10',
            });
            const month = data.getChildren(current.id)[0];
            const day = data.getChildren(month.id).find((d) => d.properties.date === '2026-06-10')!;

            const result = await data.runAction(mechanisms()[0].id, 'selectToday');

            expect(result.ok).toBe(true);
            expect(reveal).toHaveBeenCalledTimes(1);
            expect(reveal).toHaveBeenCalledWith(day.id);
        });
    });

    it('selectToday_action_selectsWeekendDayToo', async () => {
        await atDate(2026, 6, 13, async () => {
            const { data, reveal, mechanisms, current } = await start();
            await data.runAction(current.id, 'createTask', { title: 'Т', date: '2026-06-13' });
            const day = data.getChildren(data.getChildren(current.id)[0].id)[0];
            expect(day.type).toBe('DayOff');

            await data.runAction(mechanisms()[0].id, 'selectToday');

            expect(reveal).toHaveBeenCalledWith(day.id);
        });
    });

    it('selectToday_noDayForToday_returnsMessageCreatesNoObjectsSelectsNothing', async () => {
        await atDate(2026, 6, 10, async () => {
            const { api, data, reveal, mechanisms, current } = await start();
            await data.runAction(current.id, 'createTask', { title: 'Вчера', date: '2026-06-09' });
            const sentBefore = api.changesets.length;
            const countBefore = data.getChildren(data.getChildren(current.id)[0].id).length;

            const result = await data.runAction(mechanisms()[0].id, 'selectToday');

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
