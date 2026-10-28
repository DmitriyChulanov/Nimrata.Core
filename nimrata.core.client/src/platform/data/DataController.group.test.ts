import { describe, expect, it } from 'vitest';

import { createDataController } from './DataController';
import { createFakeApi } from './fakeApi';

const types = [
    {
        id: 'Item',
        name: 'Элемент',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'name', name: 'Название', kind: 'string' }],
        actions: [
            { id: 'mark', name: 'Отметить', placements: ['propertyGrid'] },
            {
                id: 'pick',
                name: 'Выбрать',
                placements: ['propertyGrid'],
                parameters: [{ id: 'level', name: 'Уровень', kind: 'enum' }],
            },
        ],
    },
    {
        id: 'Other',
        name: 'Другой',
        extension: 't',
        extensionVersion: 1,
        actions: [{ id: 'mark', name: 'Отметить', placements: ['propertyGrid'] }],
    },
];

const objects = [
    { id: 'a', type: 'Item', parent: null, order: 0, properties: { name: 'Первый' } },
    { id: 'b', type: 'Item', parent: null, order: 1, properties: { name: 'Второй' } },
    { id: 'c', type: 'Other', parent: null, order: 2, properties: {} },
];

async function setup() {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    return { api, data };
}

/**
 * Контроллер данных: действия над группой объектов
 */
describe('DataController: group actions', () => {
    /**
     * Проверяет, что запуск по группе — один набор изменений и один шаг отмены, объекты идут по очереди
     */
    it('runActionOnMany_group_oneChangesetOneUndoStepInOrder', async () => {
        const { api, data } = await setup();
        const visited: string[] = [];
        data.registerAction('Item', 'mark', (ctx) => {
            visited.push(ctx.object.id);
            ctx.tx.setProperty(ctx.object.id, 'name', `${ctx.object.id}!`);
        });

        const result = await data.runActionOnMany(['b', 'a'], 'mark');

        expect(result.ok).toBe(true);
        expect(visited).toEqual(['b', 'a']);
        expect(api.changesets).toHaveLength(1);
        await data.undo();
        expect(data.getObject('a')?.properties.name).toBe('Первый');
        expect(data.getObject('b')?.properties.name).toBe('Второй');
    });

    /**
     * Проверяет, что отказ на втором объекте откатывает первый и называет объект
     */
    it('runActionOnMany_secondObjectFails_rollsBackAllAndNamesObject', async () => {
        const { api, data } = await setup();
        data.registerAction('Item', 'mark', (ctx) => {
            ctx.tx.setProperty(ctx.object.id, 'name', 'новое');
            if (ctx.object.id === 'b') throw new Error('не получилось');
        });

        const result = await data.runActionOnMany(['a', 'b'], 'mark');

        expect(result).toEqual({ ok: false, error: 'Второй: не получилось' });
        expect(data.getObject('a')?.properties.name).toBe('Первый');
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что действие группы есть, только если оно объявлено у каждого объекта
     */
    it('getGroupActions_typesDiffer_onlyCommonActionsShown', async () => {
        const { data } = await setup();
        data.registerAction('Item', 'mark', () => {});
        data.registerAction('Item', 'pick', () => {});
        data.registerAction('Other', 'mark', () => {});

        const ids = (objectIds: string[]) =>
            data.getGroupActions(objectIds, 'propertyGrid').map((g) => g.action.id);
        expect(ids(['a', 'b'])).toEqual(['mark', 'pick']);
        expect(ids(['a', 'c'])).toEqual(['mark']);
    });

    /**
     * Проверяет, что недоступное одному объекту действие группы видно, но отключено с причиной
     */
    it('getGroupActions_unavailableForOne_shownDisabledWithReason', async () => {
        const { data } = await setup();
        data.registerAction('Item', 'mark', () => {}, {
            available: (object) => object.id !== 'b',
        });

        expect(data.getGroupActions(['a', 'b'], 'propertyGrid')).toEqual([
            {
                action: expect.objectContaining({ id: 'mark' }),
                unavailable: 'Недоступно для объекта «Второй»',
            },
        ]);
        expect(data.getGroupActions(['b'], 'propertyGrid')).toEqual([]);
    });

    /**
     * Проверяет, что варианты параметров группы — пересечение, а пустое пересечение делает действие недоступным
     */
    it('getGroupActionParameters_enumValues_intersectionOrNullWhenEmpty', async () => {
        const { data } = await setup();
        const levels = {
            a: [
                { value: 'low', name: 'Низкий' },
                { value: 'high', name: 'Высокий' },
            ],
            b: [{ value: 'high', name: 'Высокий' }],
        };
        let current: Record<string, typeof levels.a> = levels;
        data.registerAction('Item', 'pick', () => {}, {
            parameterValues: { level: (object) => current[object.id as 'a' | 'b'] ?? [] },
        });
        const pick = data.getType('Item')!.actions!.find((a) => a.id === 'pick')!;

        const common = data.getGroupActionParameters(['a', 'b'], pick);
        expect(common?.[0]?.values).toEqual([{ value: 'high', name: 'Высокий' }]);

        current = { a: levels.a, b: [] };
        expect(data.getGroupActionParameters(['a', 'b'], pick)).toBeNull();
        expect(data.getGroupActions(['a', 'b'], 'propertyGrid')[0]?.unavailable).toBe(
            'Нет общих значений параметров',
        );
    });
});
