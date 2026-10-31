import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { createFakeApi } from '@platform/data/fakeApi';

import { ObjectTreePicker } from './ObjectTreePicker';

import type { DataController } from '@platform/data/DataController';

const types = [
    {
        id: 'Folder',
        name: 'Папка',
        extension: 't',
        extensionVersion: 1,
        allowedChildren: ['Folder', 'Item'],
        properties: [{ id: 'name', name: 'Имя', kind: 'string' }],
    },
    {
        id: 'Item',
        name: 'Элемент',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'name', name: 'Имя', kind: 'string' }],
    },
];

function obj(id: string, type: string, parent: string | null, number: number, name: string) {
    return { id, type, parent, number, properties: { name } };
}

const objects = [
    obj('home', 'Folder', null, 1, 'Дом'),
    obj('kitchen', 'Folder', 'home', 1, 'Кухня'),
    obj('shelf', 'Item', 'kitchen', 1, 'Полка'),
    obj('hall', 'Item', 'home', 2, 'Прихожая'),
    obj('work', 'Folder', null, 2, 'Работа'),
];

async function controller(): Promise<DataController> {
    const data = createDataController({ api: createFakeApi(types, objects) });
    await data.load();
    return data;
}

const names = () => screen.getAllByRole('treeitem').map((i) => i.getAttribute('aria-label'));

/**
 * Универсальная панель выбора объекта в дереве
 */
describe('ObjectTreePicker', () => {
    /**
     * Проверяет, что без выбора дерево свёрнуто, а узлы раскрываются и сворачиваются кнопкой
     */
    it('objectTreePicker_noSelection_isCollapsedAndTogglesNodes', async () => {
        const data = await controller();
        render(<ObjectTreePicker data={data} label="Дерево" selected={null} onSelect={vi.fn()} />);

        expect(names()).toEqual(['Дом', 'Работа']);
        await userEvent.click(screen.getAllByRole('button', { name: 'Развернуть' })[0]);
        expect(names()).toEqual(['Дом', 'Кухня', 'Прихожая', 'Работа']);
        await userEvent.click(screen.getAllByRole('button', { name: 'Свернуть' })[0]);
        expect(names()).toEqual(['Дом', 'Работа']);
    });

    /**
     * Проверяет, что дерево раскрыто до выбранного узла по цепочке предков
     */
    it('objectTreePicker_selectedNode_expandsAncestorsAndMarksSelected', async () => {
        const data = await controller();
        render(<ObjectTreePicker data={data} label="Дерево" selected="shelf" onSelect={vi.fn()} />);

        expect(names()).toEqual(['Дом', 'Кухня', 'Полка', 'Прихожая', 'Работа']);
        expect(screen.getByRole('treeitem', { name: 'Полка' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    /**
     * Проверяет, что корень выбора скрывает себя и остальное дерево
     */
    it('objectTreePicker_rootId_showsOnlyDescendantsOfRoot', async () => {
        const data = await controller();
        render(
            <ObjectTreePicker
                data={data}
                label="Дерево"
                rootId="home"
                selected={null}
                onSelect={vi.fn()}
            />,
        );

        expect(names()).toEqual(['Кухня', 'Прихожая']);
        expect(screen.getByRole('treeitem', { name: 'Кухня' })).toHaveAttribute('aria-level', '1');
    });

    /**
     * Проверяет, что щелчок выбирает, двойной щелчок подтверждает, а недопустимый узел не подтверждается
     */
    it('objectTreePicker_clicks_selectAndConfirmOnlyAllowedNodes', async () => {
        const data = await controller();
        const onSelect = vi.fn();
        const onConfirm = vi.fn();
        render(
            <ObjectTreePicker
                data={data}
                label="Дерево"
                isAllowed={(o) => o.type === 'Folder'}
                selected={null}
                onSelect={onSelect}
                onConfirm={onConfirm}
            />,
        );

        await userEvent.click(screen.getByRole('treeitem', { name: 'Работа' }));
        await userEvent.dblClick(screen.getByRole('treeitem', { name: 'Работа' }));
        await userEvent.click(screen.getAllByRole('button', { name: 'Развернуть' })[0]);
        await userEvent.dblClick(screen.getByRole('treeitem', { name: 'Прихожая' }));

        expect(onSelect).toHaveBeenCalledWith('work');
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledWith('work');
        expect(screen.getByRole('treeitem', { name: 'Прихожая' })).toHaveAttribute(
            'aria-disabled',
            'true',
        );
    });

    /**
     * Проверяет клавиатуру: стрелки переходят по узлам, вправо и влево раскрывают и сворачивают,
     * пробел выбирает, Enter подтверждает
     */
    it('objectTreePicker_keyboard_navigatesExpandsSelectsAndConfirms', async () => {
        const data = await controller();
        const onSelect = vi.fn();
        const onConfirm = vi.fn();
        render(
            <ObjectTreePicker
                data={data}
                label="Дерево"
                selected={null}
                onSelect={onSelect}
                onConfirm={onConfirm}
            />,
        );

        await userEvent.tab();
        expect(screen.getByRole('treeitem', { name: 'Дом' })).toHaveFocus();
        await userEvent.keyboard('{ArrowRight}');
        expect(names()).toEqual(['Дом', 'Кухня', 'Прихожая', 'Работа']);
        await userEvent.keyboard('{ArrowRight}');
        expect(screen.getByRole('treeitem', { name: 'Кухня' })).toHaveFocus();
        await userEvent.keyboard('{ArrowLeft}');
        expect(screen.getByRole('treeitem', { name: 'Дом' })).toHaveFocus();
        await userEvent.keyboard('{End}');
        expect(screen.getByRole('treeitem', { name: 'Работа' })).toHaveFocus();
        await userEvent.keyboard(' ');
        expect(onSelect).toHaveBeenLastCalledWith('work');
        await userEvent.keyboard('{Home}{ArrowLeft}{Enter}');

        expect(onConfirm).toHaveBeenCalledWith('home');
        expect(names()).toEqual(['Дом', 'Работа']);
    });
});
