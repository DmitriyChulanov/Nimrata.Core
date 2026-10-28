import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { DataProvider } from '@platform/data/DataProvider';
import { createFakeApi } from '@platform/data/fakeApi';
import { SelectionProvider } from '@platform/selection/SelectionProvider';
import { useSelection } from '@platform/selection/useSelection';

import { Tree } from './Tree';

const types = [
    {
        id: 'Folder',
        name: 'Папка',
        extension: 't',
        extensionVersion: 1,
        icon: 'folder',
        allowedChildren: ['Note', 'Folder'],
    },
    { id: 'Note', name: 'Заметка', extension: 't', extensionVersion: 1, icon: 'file-text' },
];

function obj(id: string, type: string, parent: string | null, order: number, name: string) {
    return { id, type, parent, order, properties: { name } };
}

function RevealButton({ target }: { target: string }) {
    const { reveal } = useSelection();
    return <button onClick={() => reveal(target)}>Перейти</button>;
}

async function renderWithReveal(objects: unknown[], target: string) {
    const controller = createDataController({ api: createFakeApi(types, objects) });
    await controller.load();
    render(
        <DataProvider controller={controller}>
            <SelectionProvider>
                <Tree />
                <RevealButton target={target} />
            </SelectionProvider>
        </DataProvider>,
    );
}

const names = () => screen.getAllByRole('treeitem').map((n) => n.getAttribute('aria-label'));

/**
 * Дерево: переход к объекту (reveal)
 */
describe('Tree: reveal', () => {
    /**
     * Проверяет, что переход раскрывает всех предков объекта и строка объекта появляется
     */
    it('tree_reveal_expandsAncestorsOfTarget', async () => {
        const user = userEvent.setup();
        await renderWithReveal(
            [
                obj('r', 'Folder', null, 0, 'Корень'),
                obj('m', 'Folder', 'r', 0, 'Середина'),
                obj('leaf', 'Note', 'm', 0, 'Лист'),
            ],
            'leaf',
        );
        expect(names()).toEqual(['Корень']);

        await user.click(screen.getByRole('button', { name: 'Перейти' }));

        expect(names()).toEqual(['Корень', 'Середина', 'Лист']);
    });

    /**
     * Проверяет, что после раскрытия предков список прокручивается к строке объекта
     */
    it('tree_reveal_scrollsToTargetRow', async () => {
        const user = userEvent.setup();
        await renderWithReveal(
            [
                obj('r', 'Folder', null, 0, 'Корень'),
                ...Array.from({ length: 200 }, (_, i) =>
                    obj(`n${i}`, 'Note', 'r', i, `Заметка ${i}`),
                ),
            ],
            'n150',
        );

        await user.click(screen.getByRole('button', { name: 'Перейти' }));

        // Строка заметки n150 — после корня и 150 заметок: индекс 151, высота строки 24
        expect(screen.getByRole('tree').scrollTop).toBe(151 * 24);
    });
});
