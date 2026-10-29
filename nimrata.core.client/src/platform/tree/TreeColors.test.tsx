import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { DataProvider } from '@platform/data/DataProvider';
import { createFakeApi } from '@platform/data/fakeApi';
import { SelectionProvider } from '@platform/selection/SelectionProvider';

import { Tree } from './Tree';

const types = [
    {
        id: 'Task',
        name: 'Задача',
        extension: 't',
        extensionVersion: 1,
        properties: [
            { id: 'name', name: 'Название', kind: 'string' },
            { id: 'priority', name: 'Приоритет', kind: 'string' },
            { id: 'status', name: 'Статус', kind: 'string' },
        ],
        colorRules: [
            { property: 'priority', equals: 'medium', color: 'orange' },
            { property: 'priority', equals: 'high', color: 'red' },
            { property: 'status', equals: 'completed', color: 'green' },
            { property: 'priority', equals: 'low', color: '#123456' },
        ],
    },
    { id: 'Plain', name: 'Простой', extension: 't', extensionVersion: 1 },
];

function task(id: string, number: number, properties: Record<string, unknown>) {
    return { id, type: 'Task', parent: null, number, properties: { name: id, ...properties } };
}

async function renderColored(objects: unknown[]) {
    const controller = createDataController({ api: createFakeApi(types, objects) });
    await controller.load();
    render(
        <DataProvider controller={controller}>
            <SelectionProvider>
                <Tree />
            </SelectionProvider>
        </DataProvider>,
    );
    return controller;
}

const colorOf = (name: string) =>
    screen.getByRole('treeitem', { name }).getAttribute('data-rule-color');

/**
 * Дерево: правила цвета
 */
describe('Tree: color rules', () => {
    /**
     * Проверяет, что узел окрашивается, когда значения свойств удовлетворяют правилу
     */
    it('treeColors_node_isPaintedWhenPropertyValuesSatisfyRule', async () => {
        await renderColored([
            task('a', 0, { priority: 'high' }),
            task('b', 1, { priority: 'medium' }),
            { id: 'p', type: 'Plain', parent: null, number: 2, properties: { name: 'p' } },
        ]);

        expect(colorOf('a')).toBe('red');
        expect(colorOf('b')).toBe('orange');
        expect(colorOf('p')).toBeNull();
    });

    /**
     * Проверяет, что узел без подходящего правила не окрашивается
     */
    it('treeColors_nodeWithoutMatchingRule_isNotPainted', async () => {
        await renderColored([task('a', 0, { priority: 'none' })]);

        expect(colorOf('a')).toBeNull();
    });

    /**
     * Проверяет, что при нескольких подходящих правилах выигрывает первое в манифесте
     */
    it('treeColors_severalMatchingRules_firstInManifestWins', async () => {
        await renderColored([task('a', 0, { priority: 'high', status: 'completed' })]);

        expect(colorOf('a')).toBe('red');
    });

    /**
     * Проверяет, что цвет вне палитры задаётся напрямую
     */
    it('treeColors_colorOutsidePalette_isSetDirectly', async () => {
        await renderColored([task('a', 0, { priority: 'low' })]);

        expect(screen.getByRole('treeitem', { name: 'a' })).toHaveStyle({ color: '#123456' });
    });

    /**
     * Проверяет, что цвет меняется вместе со свойством без перезагрузки
     */
    it('treeColors_colorChangesWithProperty_withoutReload', async () => {
        const controller = await renderColored([task('a', 0, { priority: 'medium' })]);
        expect(colorOf('a')).toBe('orange');

        await act(() => controller.setProperty('a', 'priority', 'high'));
        expect(colorOf('a')).toBe('red');

        await act(() => controller.setProperty('a', 'priority', 'none'));
        expect(colorOf('a')).toBeNull();
    });
});
