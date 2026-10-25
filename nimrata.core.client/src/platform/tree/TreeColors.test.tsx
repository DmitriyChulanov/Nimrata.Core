import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createDataController } from '../data/DataController';
import { DataProvider } from '../data/DataProvider';
import { createFakeApi } from '../data/fakeApi';
import { SelectionProvider } from '../selection/SelectionProvider';
import { Tree } from './Tree';

const types = [
    {
        id: 'Task',
        name: 'Задача',
        module: 't',
        moduleVersion: 1,
        colorRules: [
            { property: 'priority', equals: 'medium', color: 'orange' },
            { property: 'priority', equals: 'high', color: 'red' },
            { property: 'status', equals: 'completed', color: 'green' },
            { property: 'priority', equals: 'low', color: '#123456' },
        ],
    },
    { id: 'Plain', name: 'Простой', module: 't', moduleVersion: 1 },
];

function task(id: string, order: number, properties: Record<string, unknown>) {
    return { id, type: 'Task', parent: null, order, properties: { name: id, ...properties } };
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

describe('Tree: цветовые правила', () => {
    it('красит узел, значения свойств которого удовлетворяют правилу', async () => {
        await renderColored([
            task('a', 0, { priority: 'high' }),
            task('b', 1, { priority: 'medium' }),
            { id: 'p', type: 'Plain', parent: null, order: 2, properties: { name: 'p' } },
        ]);

        expect(colorOf('a')).toBe('red');
        expect(colorOf('b')).toBe('orange');
        expect(colorOf('p')).toBeNull();
    });

    it('узел без подходящего правила не окрашивается', async () => {
        await renderColored([task('a', 0, { priority: 'none' })]);

        expect(colorOf('a')).toBeNull();
    });

    it('при нескольких подходящих правилах побеждает первое в манифесте', async () => {
        await renderColored([task('a', 0, { priority: 'high', status: 'completed' })]);

        expect(colorOf('a')).toBe('red');
    });

    it('цвет вне палитры задаётся напрямую', async () => {
        await renderColored([task('a', 0, { priority: 'low' })]);

        expect(screen.getByRole('treeitem', { name: 'a' })).toHaveStyle({ color: '#123456' });
    });

    it('цвет меняется вместе со свойством, без перезагрузки', async () => {
        const controller = await renderColored([task('a', 0, { priority: 'medium' })]);
        expect(colorOf('a')).toBe('orange');

        await act(() => controller.setProperty('a', 'priority', 'high'));
        expect(colorOf('a')).toBe('red');

        await act(() => controller.setProperty('a', 'priority', 'none'));
        expect(colorOf('a')).toBeNull();
    });
});
