import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { DataProvider } from '@platform/data/DataProvider';
import { createFakeApi } from '@platform/data/fakeApi';
import { SelectionProvider } from '@platform/selection/SelectionProvider';

import { Tree } from './Tree';

import type { TypeDefinition } from '@platform/types/types';

// Значок типа рисуется по одному на отрисовку строки: по нему считаются отрисовки строк
const iconRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('./TypeIcon', () => ({
    TypeIcon: ({ type }: { type: TypeDefinition | undefined }) => {
        iconRenders.count++;
        return <span data-type={type?.id} />;
    },
}));

const types = [
    {
        id: 'Folder',
        name: 'Папка',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'name', name: 'Имя', kind: 'string' }],
    },
];

const folder = (id: string, parent: string | null, number: number, name: string) => ({
    id,
    type: 'Folder',
    parent,
    number,
    properties: { name },
});

/**
 * Дерево: адресная перерисовка строк
 */
describe('Tree: memoized rows', () => {
    /**
     * Проверяет, что правка одного объекта перерисовывает только его строку
     */
    it('propertyChange_rerendersOnlyThatRow', async () => {
        const data = createDataController({
            api: createFakeApi(types, [
                folder('a', null, 1, 'A'),
                folder('b', null, 2, 'B'),
                folder('c', null, 3, 'C'),
            ]),
        });
        await data.load();
        render(
            <DataProvider controller={data}>
                <SelectionProvider>
                    <Tree />
                </SelectionProvider>
            </DataProvider>,
        );
        expect(screen.getAllByRole('treeitem')).toHaveLength(3);
        iconRenders.count = 0;

        await act(() => data.setProperty('b', 'name', 'B2'));

        expect(screen.getByRole('treeitem', { name: 'B2' })).toBeInTheDocument();
        expect(iconRenders.count).toBe(1);
    });

    /**
     * Проверяет, что правка объекта внутри свёрнутого узла не перерисовывает ни одной строки
     */
    it('changeInsideCollapsedNode_rerendersNoRows', async () => {
        const data = createDataController({
            api: createFakeApi(types, [folder('a', null, 1, 'A'), folder('x', 'a', 1, 'X')]),
        });
        await data.load();
        render(
            <DataProvider controller={data}>
                <SelectionProvider>
                    <Tree />
                </SelectionProvider>
            </DataProvider>,
        );
        iconRenders.count = 0;

        await act(() => data.setProperty('x', 'name', 'X2'));

        expect(iconRenders.count).toBe(0);
    });
});
