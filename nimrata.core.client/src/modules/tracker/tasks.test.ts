import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform';
import type { DataController, DataObject, TypeDefinition } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureStartStructure, registerTracker, taskDate } from './tracker';

const types = manifest.types.map((t) => ({
    ...t,
    module: manifest.module,
    moduleVersion: manifest.version,
})) as TypeDefinition[];

async function start(options?: Parameters<typeof registerTracker>[1]) {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    registerTracker(data, options);
    await ensureStartStructure(data);
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

describe('Трекер: создание задачи', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 2, 4, 10, 0)); // среда, 4 марта 2026
    });
    afterEach(() => vi.useRealTimers());

    it('на заданную дату создаёт месяц и день внутри «Текущих задач» и кладёт задачу в день', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { title: 'Позвонить', date: '2026-03-05' });

        const month = byName(data, root.id, 'март, 2026')!;
        expect(month.type).toBe('Month');
        const day = byName(data, month.id, '05.03.2026, четверг')!;
        expect(day.type).toBe('Day');
        const tasks = data.getChildren(day.id);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].type).toBe('Task');
        expect(tasks[0].properties.title).toBe('Позвонить');
        expect(tasks[0].properties.name).toBe('Позвонить');
    });

    it('без даты использует сегодня', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { title: 'Сегодняшняя' });

        const month = byName(data, root.id, 'март, 2026')!;
        expect(byName(data, month.id, '04.03.2026, среда')).toBeDefined();
    });

    it('всё создаётся одним набором изменений', async () => {
        const { api, data } = await start();
        const before = api.changesets.length;

        await createTask(data, current(data), { title: 'А', date: '2026-04-01' });

        expect(api.changesets.length - before).toBe(1);
    });

    it('повторно использует существующие месяц и день', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { title: 'Раз', date: '2026-03-05' });
        await createTask(data, root, { title: 'Два', date: '2026-03-05' });
        await createTask(data, root, { title: 'Три', date: '2026-03-06' });

        expect(data.getChildren(root.id)).toHaveLength(1);
        const month = data.getChildren(root.id)[0];
        expect(data.getChildren(month.id)).toHaveLength(2);
        expect(data.getChildren(byName(data, month.id, '05.03.2026, четверг')!.id)).toHaveLength(2);
    });

    it('название задачи не может быть пустым', async () => {
        const { data } = await start();

        const result = await data.runAction(current(data).id, 'createTask', { title: '  ' });

        expect(result.ok).toBe(false);
    });

    it('имя задачи с временем — «HH:mm — Название» и пересчитывается при правке', async () => {
        const { data } = await start();
        await createTask(data, current(data), { title: 'Позвонить', date: '2026-03-05' });
        const task = findTask(data, 'Позвонить');

        await data.setProperty(task.id, 'time', '09:30');
        expect(data.getObject(task.id)!.properties.name).toBe('09:30 — Позвонить');

        await data.setProperty(task.id, 'title', 'Написать');
        expect(data.getObject(task.id)!.properties.name).toBe('09:30 — Написать');

        await data.setProperty(task.id, 'time', null);
        expect(data.getObject(task.id)!.properties.name).toBe('Написать');
    });

    it('дата задачи выводится из дня-родителя и нигде не хранится', async () => {
        const { data } = await start();
        await createTask(data, current(data), { title: 'Д', date: '2026-03-05' });
        const task = findTask(data, 'Д');

        expect(taskDate(data, task)).toBe('2026-03-05');
        expect(Object.keys(task.properties)).not.toContain('date');
    });
});

describe('Трекер: категории', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 2, 4, 10, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('категория создаётся внутри дня, повторное название находит существующую', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { title: 'А', date: '2026-03-05', category: 'Работа' });
        await createTask(data, root, { title: 'Б', date: '2026-03-05', category: 'Работа' });
        await createTask(data, root, { title: 'В', date: '2026-03-05', category: 'Личное' });

        const month = data.getChildren(root.id)[0];
        const day = data.getChildren(month.id)[0];
        const categories = data.getChildren(day.id);
        expect(categories.map((c) => c.properties.name).sort()).toEqual(['Личное', 'Работа']);
        const work = categories.find((c) => c.properties.name === 'Работа')!;
        expect(data.getChildren(work.id)).toHaveLength(2);
    });

    it('действие на категории создаёт вложенную категорию внутри неё', async () => {
        const { data } = await start();
        const root = current(data);
        await createTask(data, root, { title: 'А', date: '2026-03-05', category: 'Работа' });
        const work = findCategory(data, 'Работа');

        await createTask(data, work, { title: 'Б', category: 'Проект' });
        // Без даты на категории задача создаётся в день категории, а не на сегодня.
        const nested = data.getChildren(work.id).find((o) => o.type === 'Category')!;
        expect(nested.properties.name).toBe('Проект');
        expect(taskDate(data, data.getChildren(nested.id)[0])).toBe('2026-03-05');
    });

    it('действие на категории без указания категории кладёт задачу в неё', async () => {
        const { data } = await start();
        await createTask(data, current(data), {
            title: 'А',
            date: '2026-03-05',
            category: 'Работа',
        });
        const work = findCategory(data, 'Работа');

        await createTask(data, work, { title: 'Б' });

        expect(data.getChildren(work.id)).toHaveLength(2);
    });

    it('действие на дне с другой датой создаёт задачу в нужном дне', async () => {
        const { data } = await start();
        await createTask(data, current(data), { title: 'А', date: '2026-03-05' });
        const month = data.getChildren(current(data).id)[0];
        const day = data.getChildren(month.id)[0];

        await createTask(data, day, { title: 'Б', date: '2026-03-09' });

        expect(taskDate(data, findTask(data, 'Б'))).toBe('2026-03-09');
        expect(data.getChildren(month.id)).toHaveLength(2);
    });
});

describe('Трекер: дни, порядок, выходные', () => {
    it('суббота и воскресенье — «День-выходной», будни — «День»', async () => {
        const { data } = await start();
        const root = current(data);

        for (const date of ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09']) {
            await createTask(data, root, { title: date, date });
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

    it('месяцы и дни получают порядок по дате независимо от порядка создания', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { title: 'a', date: '2026-12-10' });
        await createTask(data, root, { title: 'b', date: '2026-02-20' });
        await createTask(data, root, { title: 'c', date: '2026-02-03' });

        const months = [...data.getChildren(root.id)].sort((x, y) => x.order - y.order);
        expect(months.map((m) => m.properties.date)).toEqual(['2026-02-01', '2026-12-01']);
        const days = [...data.getChildren(months[0].id)].sort((x, y) => x.order - y.order);
        expect(days.map((d) => d.properties.date)).toEqual(['2026-02-03', '2026-02-20']);
    });

    it('год 2027 идёт после декабря 2026', async () => {
        const { data } = await start();
        const root = current(data);

        await createTask(data, root, { title: 'a', date: '2027-01-10' });
        await createTask(data, root, { title: 'b', date: '2026-12-10' });

        const months = [...data.getChildren(root.id)].sort((x, y) => x.order - y.order);
        expect(months.map((m) => m.properties.date)).toEqual(['2026-12-01', '2027-01-01']);
    });

    it('некорректная дата отклоняется', async () => {
        const { data } = await start();

        const result = await data.runAction(current(data).id, 'createTask', {
            title: 'x',
            date: '2026-02-31',
        });

        expect(result.ok).toBe(false);
    });
});

describe('Трекер: порядок задач дня', () => {
    it('задачи дня идут по времени независимо от порядка создания; без времени — первыми', async () => {
        const { data } = await start();
        const root = current(data);
        for (const title of ['Поздняя', 'Ранняя', 'Без времени']) {
            await createTask(data, root, { title, date: '2026-03-05' });
        }
        await data.setProperty(findTask(data, 'Поздняя').id, 'time', '18:00');
        await data.setProperty(findTask(data, 'Ранняя').id, 'time', '09:00');

        const day = data.getChildren(data.getChildren(root.id)[0].id)[0];
        const ordered = [...data.getChildren(day.id)].sort((a, b) => a.order - b.order);
        expect(ordered.map((t) => t.properties.title)).toEqual([
            'Без времени',
            'Ранняя',
            'Поздняя',
        ]);
    });
});

describe('Трекер: ссылки задачи', () => {
    it('«Перейти по внешней ссылке» открывает http(s) в новой вкладке', async () => {
        const { data } = await start();
        await createTask(data, current(data), { title: 'А', date: '2026-03-05' });
        const task = findTask(data, 'А');
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        await data.setProperty(task.id, 'link', 'https://example.com/x');

        const result = await data.runAction(task.id, 'openExternalLink');

        expect(result.ok).toBe(true);
        expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');
        open.mockRestore();
    });

    it('внешняя ссылка не http(s) отклоняется', async () => {
        const { data } = await start();
        await createTask(data, current(data), { title: 'А', date: '2026-03-05' });
        const task = findTask(data, 'А');
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        await data.setProperty(task.id, 'link', 'javascript:alert(1)');

        const result = await data.runAction(task.id, 'openExternalLink');

        expect(result.ok).toBe(false);
        expect(open).not.toHaveBeenCalled();
        open.mockRestore();
    });

    it('«Перейти по внутренней ссылке» показывает целевой объект в дереве', async () => {
        const reveal = vi.fn();
        const { data } = await start({ reveal });
        await createTask(data, current(data), { title: 'А', date: '2026-03-05' });
        await createTask(data, current(data), { title: 'Б', date: '2026-03-06' });
        const a = findTask(data, 'А');
        const b = findTask(data, 'Б');
        await data.setProperty(a.id, 'internalLink', b.id);

        const result = await data.runAction(a.id, 'openInternalLink');

        expect(result.ok).toBe(true);
        expect(reveal).toHaveBeenCalledWith(b.id);
    });

    it('внутренняя ссылка на удалённый объект даёт понятную ошибку', async () => {
        const reveal = vi.fn();
        const { data } = await start({ reveal });
        await createTask(data, current(data), { title: 'А', date: '2026-03-05' });
        const a = findTask(data, 'А');
        await data.setProperty(a.id, 'internalLink', 'нет-такого');

        const result = await data.runAction(a.id, 'openInternalLink');

        expect(result).toEqual({ ok: false, error: 'Объект по ссылке недоступен.' });
        expect(reveal).not.toHaveBeenCalled();
    });

    it('действия-ссылки недоступны, пока ссылка не задана', async () => {
        const { data } = await start();
        await createTask(data, current(data), { title: 'А', date: '2026-03-05' });
        const task = findTask(data, 'А');

        const ids = data.getActions(task.id, 'contextMenu').map((a) => a.id);

        expect(ids).not.toContain('openExternalLink');
        expect(ids).not.toContain('openInternalLink');
    });
});

describe('Манифест Трекера: задача', () => {
    it('свойства задачи и цветовые правила приоритета описаны', () => {
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
            if (child.type === 'Task' && child.properties.title === title) return child;
            const found = walk(child.id);
            if (found) return found;
        }
    };
    return walk(null)!;
}
