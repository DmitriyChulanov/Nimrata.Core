import { fireEvent, render, screen, within } from '@testing-library/react';
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
        module: 't',
        moduleVersion: 1,
        icon: 'folder',
        allowedChildren: ['Note', 'Folder', 'Base'],
    },
    { id: 'Note', name: 'Заметка', module: 't', moduleVersion: 1, icon: 'file-text' },
    { id: 'Base', name: 'Основа', module: 't', moduleVersion: 1, abstract: true },
    { id: 'Hidden', name: 'Механизм', module: 't', moduleVersion: 1, hiddenInTree: true },
];

function obj(id: string, type: string, parent: string | null, order: number, name?: string) {
    return { id, type, parent, order, properties: name === undefined ? {} : { name } };
}

function SelectionProbe() {
    return <output aria-label="выделено">{useSelection().selectedId ?? ''}</output>;
}

async function renderTree(objects: unknown[]) {
    const api = createFakeApi(types, objects);
    const controller = createDataController({ api });
    await controller.load();
    render(
        <DataProvider controller={controller}>
            <SelectionProvider>
                <Tree />
                <SelectionProbe />
            </SelectionProvider>
        </DataProvider>,
    );
    return { api, controller };
}

const names = () => screen.getAllByRole('treeitem').map((n) => n.getAttribute('aria-label'));

/**
 * Дерево: отображение
 */
describe('Tree: rendering', () => {
    /**
     * Проверяет, что корневые узлы показываются с именем из свойства и значком типа
     */
    it('tree_renders_rootNodesWithNameFromPropertyAndTypeIcon', async () => {
        await renderTree([obj('r', 'Folder', null, 0, 'Мои папки')]);

        const item = screen.getByRole('treeitem', { name: 'Мои папки' });
        expect(item.querySelector('svg.lucide-folder')).not.toBeNull();
    });

    /**
     * Проверяет, что без имени показывается название типа
     */
    it('tree_withoutName_showsTypeName', async () => {
        await renderTree([obj('n', 'Note', null, 0)]);

        expect(screen.getByRole('treeitem', { name: 'Заметка' })).toBeInTheDocument();
    });

    /**
     * Проверяет, что узлы упорядочены по порядку, затем по названию
     */
    it('tree_nodes_sortedByOrderThenByName', async () => {
        await renderTree([
            obj('c', 'Note', null, 2, 'Аааа'),
            obj('b', 'Note', null, 1, 'Яблоко'),
            obj('a', 'Note', null, 1, 'Арбуз'),
        ]);

        expect(names()).toEqual(['Арбуз', 'Яблоко', 'Аааа']);
    });

    /**
     * Проверяет, что объекты скрытых в дереве типов не показываются
     */
    it('tree_hiddenInTreeTypes_objectsAreNotShown', async () => {
        await renderTree([
            obj('h', 'Hidden', null, 0, 'Скрытый'),
            obj('n', 'Note', null, 1, 'Видимый'),
        ]);

        expect(names()).toEqual(['Видимый']);
    });
});

/**
 * Дерево: виртуализация
 */
describe('Tree: virtualization', () => {
    const many = Array.from({ length: 10000 }, (_, i) =>
        obj(`n${i}`, 'Note', null, i, `Заметка ${i}`),
    );

    /**
     * Проверяет, что большое дерево рисует только окно видимых строк
     */
    it('tree_largeTree_rendersOnlyVisibleRowWindow', async () => {
        await renderTree(many);

        const rendered = screen.getAllByRole('treeitem').length;
        expect(rendered).toBeGreaterThan(0);
        expect(rendered).toBeLessThan(100);
        expect(screen.getByRole('treeitem', { name: 'Заметка 0' })).toHaveAttribute(
            'aria-setsize',
            '10000',
        );
    });

    /**
     * Проверяет, что прокрутка подставляет строки из нужного места списка
     */
    it('tree_scroll_substitutesRowsFromRightPlaceOfList', async () => {
        await renderTree(many);

        fireEvent.scroll(screen.getByRole('tree'), { target: { scrollTop: 24 * 5000 } });

        expect(await screen.findByRole('treeitem', { name: 'Заметка 5000' })).toBeInTheDocument();
        expect(screen.queryByRole('treeitem', { name: 'Заметка 0' })).not.toBeInTheDocument();
    });
});

/**
 * Дерево: контекстное меню
 */
describe('Tree: context menu', () => {
    const family = [
        obj('f', 'Folder', null, 0, 'Папка'),
        obj('a', 'Note', 'f', 1, 'А'),
        obj('l', 'Note', null, 1, 'Лист'),
    ];

    const menuItems = () => screen.getAllByRole('menuitem').map((i) => i.textContent);

    /**
     * Проверяет, что меню предлагает только допустимые неабстрактные типы потомков, затем удаление
     */
    it('tree_createMenu_offersOnlyAllowedNonAbstractChildTypesThenDelete', async () => {
        const user = userEvent.setup();
        await renderTree(family);

        await user.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: 'Папка' }),
        });

        expect(menuItems()).toEqual(['Создать: Заметка', 'Создать: Папка', 'Удалить']);
    });

    /**
     * Проверяет, что у типа без допустимых потомков в меню только удаление
     */
    it('tree_typeWithoutAllowedChildren_menuHasOnlyDelete', async () => {
        const user = userEvent.setup();
        await renderTree(family);

        await user.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: 'Лист' }),
        });

        expect(menuItems()).toEqual(['Удалить']);
    });

    /**
     * Проверяет, что создание добавляет потомка набором и показывает его в дереве
     */
    it('tree_create_addsChildByChangesetAndShowsItInTree', async () => {
        const user = userEvent.setup();
        const { api } = await renderTree(family);

        await user.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: 'Папка' }),
        });
        await user.click(screen.getByRole('menuitem', { name: 'Создать: Заметка' }));

        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(api.changesets).toHaveLength(1);
        expect(api.changesets[0].operations[0]).toMatchObject({
            op: 'create',
            type: 'Note',
            parent: 'f',
        });
        expect(names()).toEqual(['Папка', 'А', 'Заметка', 'Лист']);
    });

    /**
     * Проверяет, что удаление просит подтверждения, а отмена ничего не меняет
     */
    it('tree_delete_asksConfirmationCancelChangesNothing', async () => {
        const user = userEvent.setup();
        const { api } = await renderTree(family);

        await user.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: 'Папка' }),
        });
        await user.click(screen.getByRole('menuitem', { name: 'Удалить' }));
        const dialog = screen.getByRole('alertdialog');
        expect(dialog).toHaveTextContent('Папка');
        await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(api.changesets).toEqual([]);
        expect(names()).toEqual(['Папка', 'Лист']);
    });

    /**
     * Проверяет, что подтверждённое удаление убирает объект с потомками одним набором
     */
    it('tree_confirmedDelete_removesObjectWithDescendantsInOneChangeset', async () => {
        const user = userEvent.setup();
        const { api, controller } = await renderTree(family);

        await user.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: 'Папка' }),
        });
        await user.click(screen.getByRole('menuitem', { name: 'Удалить' }));
        await user.click(
            within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Удалить' }),
        );

        expect(names()).toEqual(['Лист']);
        expect(controller.getObject('a')).toBeUndefined();
        expect(api.changesets).toHaveLength(1);
        expect(api.changesets[0].operations.map((o) => o.id)).toEqual(['a', 'f']);
    });

    /**
     * Проверяет, что отказ сервера показывается сообщением, а дерево возвращается к прежнему виду
     */
    it('tree_serverRejection_isShownAsMessageAndTreeReturnsToPreviousView', async () => {
        const user = userEvent.setup();
        const { api } = await renderTree(family);
        api.rejectNext(400, 'Нельзя удалить');

        await user.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: 'Лист' }),
        });
        await user.click(screen.getByRole('menuitem', { name: 'Удалить' }));
        await user.click(
            within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Удалить' }),
        );

        expect(await screen.findByRole('alert')).toHaveTextContent('Нельзя удалить');
        expect(names()).toEqual(['Папка', 'Лист']);
    });

    /**
     * Проверяет, что `Escape` закрывает меню
     */
    it('tree_escape_closesMenu', async () => {
        const user = userEvent.setup();
        await renderTree(family);

        await user.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: 'Лист' }),
        });
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
});

/**
 * Дерево: раскрытие и выделение
 */
describe('Tree: expanding and selection', () => {
    const family = [
        obj('f', 'Folder', null, 0, 'Папка'),
        obj('b', 'Note', 'f', 2, 'Б'),
        obj('a', 'Note', 'f', 1, 'А'),
        obj('h', 'Hidden', 'f', 0, 'Скрытый'),
    ];

    /**
     * Проверяет, что потомки скрыты, пока узел не раскрыт, а кнопка раскрывает и сворачивает
     */
    it('tree_descendants_hiddenUntilNodeIsExpandedExpandAndCollapseWithButton', async () => {
        const user = userEvent.setup();
        await renderTree(family);
        expect(names()).toEqual(['Папка']);

        await user.click(screen.getByRole('button', { name: 'Развернуть' }));
        expect(names()).toEqual(['Папка', 'А', 'Б']);
        expect(screen.getByRole('treeitem', { name: 'Папка' })).toHaveAttribute(
            'aria-expanded',
            'true',
        );

        await user.click(screen.getByRole('button', { name: 'Свернуть' }));
        expect(names()).toEqual(['Папка']);
    });

    /**
     * Проверяет, что у узла без видимых потомков нет кнопки раскрытия
     */
    it('tree_nodeWithoutVisibleDescendants_hasNoExpandButton', async () => {
        await renderTree([obj('n', 'Note', null, 0, 'Лист'), obj('h', 'Hidden', 'n', 0)]);

        expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument();
    });

    /**
     * Проверяет, что щелчок выделяет объект, а выделение доступно другим панелям
     */
    it('tree_clickOnNode_selectsObjectAndSelectionIsAvailableToOtherPanels', async () => {
        const user = userEvent.setup();
        await renderTree(family);

        await user.click(screen.getByRole('treeitem', { name: 'Папка' }));

        expect(screen.getByRole('treeitem', { name: 'Папка' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(screen.getByLabelText('выделено')).toHaveTextContent('f');
    });
});
