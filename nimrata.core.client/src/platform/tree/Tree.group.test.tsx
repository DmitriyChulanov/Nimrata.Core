import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { DataProvider } from '@platform/data/DataProvider';
import { createFakeApi } from '@platform/data/fakeApi';
import { PropertyGrid } from '@platform/properties/PropertyGrid';
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
        allowedChildren: ['Note', 'Folder', 'Link'],
        properties: [{ id: 'name', name: 'Название', kind: 'string' }],
        actions: [{ id: 'open', name: 'Открыть', icon: 'globe', placements: ['contextMenu'] }],
    },
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        icon: 'file-text',
        properties: [{ id: 'name', name: 'Название', kind: 'string' }],
        actions: [{ id: 'open', name: 'Открыть', icon: 'globe', placements: ['contextMenu'] }],
    },
    {
        id: 'Link',
        name: 'Ссылка',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'target', name: 'Цель', kind: 'reference' }],
    },
];

function obj(id: string, type: string, parent: string | null, order: number, name?: string) {
    return { id, type, parent, order, properties: name === undefined ? {} : { name } };
}

function SelectionProbe() {
    const { selectedId, selectedIds } = useSelection();
    return (
        <>
            <output aria-label="основной">{selectedId ?? ''}</output>
            <output aria-label="выделены">{[...selectedIds].sort().join(',')}</output>
        </>
    );
}

async function renderTree(objects: unknown[]) {
    const api = createFakeApi(types, objects);
    const controller = createDataController({ api });
    await controller.load();
    const opened: string[] = [];
    controller.registerAction('Folder', 'open', ({ object }) => void opened.push(object.id));
    controller.registerAction('Note', 'open', ({ object }) => void opened.push(object.id));
    render(
        <DataProvider controller={controller}>
            <SelectionProvider>
                <Tree />
                <PropertyGrid />
                <SelectionProbe />
            </SelectionProvider>
        </DataProvider>,
    );
    return { api, controller, opened };
}

const item = (name: string) => screen.getByRole('treeitem', { name });
const names = () => screen.getAllByRole('treeitem').map((n) => n.getAttribute('aria-label'));
const selected = () => screen.getByLabelText('выделены').textContent;
const primary = () => screen.getByLabelText('основной').textContent;
const menuLabels = () =>
    Array.from(screen.getByRole('menu').querySelectorAll(':scope > li')).map((li) =>
        li.getAttribute('role') === 'separator' ? '—' : li.textContent,
    );

const rightClick = (user: ReturnType<typeof userEvent.setup>, name: string) =>
    user.pointer({ keys: '[MouseRight]', target: item(name) });

const family = [
    obj('f', 'Folder', null, 0, 'Папка'),
    obj('a', 'Note', 'f', 1, 'А'),
    obj('b', 'Note', 'f', 2, 'Б'),
    obj('g', 'Folder', null, 1, 'Другая'),
    obj('l', 'Note', null, 2, 'Лист'),
];

/**
 * Дерево: выделение группы
 */
describe('Tree: group selection', () => {
    /**
     * Проверяет, что Ctrl+клик добавляет узел в выделение и снимает его
     */
    it('tree_ctrlClick_addsAndRemovesNodesFromSelection', async () => {
        const user = userEvent.setup();
        await renderTree(family);

        await user.click(item('Папка'));
        await user.keyboard('{Control>}');
        await user.click(item('Лист'));
        expect(selected()).toBe('f,l');
        expect(primary()).toBe('l');
        expect(item('Лист')).toHaveAttribute('aria-selected', 'true');
        expect(item('Папка')).toHaveAttribute('aria-selected', 'true');

        await user.click(item('Лист'));
        await user.keyboard('{/Control}');
        expect(selected()).toBe('f');
        expect(primary()).toBe('f');
    });

    /**
     * Проверяет, что Shift+клик выделяет диапазон видимых строк от опорной
     */
    it('tree_shiftClick_selectsRangeOfVisibleRows', async () => {
        const user = userEvent.setup();
        await renderTree(family);
        await user.click(screen.getAllByRole('button', { name: 'Развернуть' })[0]);

        await user.click(item('А'));
        await user.keyboard('{Shift>}');
        await user.click(item('Другая'));
        await user.keyboard('{/Shift}');

        expect(selected()).toBe('a,b,g');
        expect(primary()).toBe('g');
    });

    /**
     * Проверяет, что обычный клик сбрасывает группу до одного узла
     */
    it('tree_plainClick_resetsGroupToSingleNode', async () => {
        const user = userEvent.setup();
        await renderTree(family);
        await user.click(item('Папка'));
        await user.keyboard('{Control>}');
        await user.click(item('Лист'));
        await user.keyboard('{/Control}');

        await user.click(item('Другая'));

        expect(selected()).toBe('g');
    });

    /**
     * Проверяет, что Ctrl+A выделяет все видимые узлы
     */
    it('tree_ctrlA_selectsAllVisibleRows', async () => {
        const user = userEvent.setup();
        await renderTree(family);
        await user.click(item('Папка'));

        await user.keyboard('{Control>}a{/Control}');

        expect(selected()).toBe('f,g,l');
        expect(primary()).toBe('f');
    });

    /**
     * Проверяет, что таблица свойств показывает основной узел и число выделенных объектов
     */
    it('propertyGrid_groupSelected_showsPrimaryAndCount', async () => {
        const user = userEvent.setup();
        await renderTree(family);
        await user.click(item('Лист'));
        expect(screen.queryByText(/Выделено объектов/)).not.toBeInTheDocument();

        await user.keyboard('{Control>}');
        await user.click(item('Другая'));
        await user.keyboard('{/Control}');

        expect(screen.getByText('Выделено объектов: 2')).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2, name: 'Папка' })).toBeInTheDocument();
    });
});

/**
 * Дерево: автовыделение созданного узла
 */
describe('Tree: selecting new node', () => {
    /**
     * Проверяет, что созданный узел выделяется, а его свойства показываются в таблице
     */
    it('tree_create_selectsNewNodeAndShowsItsProperties', async () => {
        const user = userEvent.setup();
        const { controller } = await renderTree(family);
        await user.click(item('Другая'));

        await rightClick(user, 'Другая');
        await user.click(screen.getByRole('menuitem', { name: 'Создать: Заметка' }));

        const created = controller.getChildren('g')[0];
        expect(selected()).toBe(created.id);
        expect(primary()).toBe(created.id);
        expect(screen.getByRole('heading', { level: 2, name: 'Заметка' })).toBeInTheDocument();
    });
});

/**
 * Дерево: контекстное меню
 */
describe('Tree: context menu layout', () => {
    /**
     * Проверяет порядок: создание, копирование, вставка, разделитель, действия, разделитель, удаление
     */
    it('tree_menu_groupsSeparatedByLinesAndDeleteIsLast', async () => {
        const user = userEvent.setup();
        await renderTree(family);

        await rightClick(user, 'Папка');

        expect(menuLabels()).toEqual([
            'Создать: Заметка',
            'Создать: Папка',
            'Создать: Ссылка',
            'Копировать',
            'Вставить',
            '—',
            'Открыть',
            '—',
            'Удалить',
        ]);
    });

    /**
     * Проверяет, что без действий лишнего разделителя нет
     */
    it('tree_menuWithoutActions_hasSingleSeparatorBeforeDelete', async () => {
        const user = userEvent.setup();
        const { controller } = await renderTree([...family, obj('k', 'Link', null, 3, 'Ссыль')]);
        expect(controller.getObject('k')).toBeDefined();

        await rightClick(user, 'Ссыль');

        expect(menuLabels()).toEqual(['Копировать', 'Вставить', '—', 'Удалить']);
    });

    /**
     * Проверяет, что у каждого пункта есть иконка
     */
    it('tree_menuItems_haveIcons', async () => {
        const user = userEvent.setup();
        await renderTree(family);

        await rightClick(user, 'Папка');

        const icons = screen
            .getAllByRole('menuitem')
            .map((i) => i.querySelector('svg')?.getAttribute('data-icon'));
        expect(icons).toEqual(['plus', 'plus', 'plus', 'copy', 'clipboard', 'globe', 'trash-2']);
    });
});

/**
 * Дерево: копирование и вставка
 */
describe('Tree: copy and paste', () => {
    /**
     * Проверяет, что вставка недоступна, пока буфер пуст
     */
    it('tree_emptyClipboard_pasteIsDisabled', async () => {
        const user = userEvent.setup();
        await renderTree(family);

        await rightClick(user, 'Папка');

        expect(screen.getByRole('menuitem', { name: 'Вставить' })).toBeDisabled();
    });

    /**
     * Проверяет, что вставка копирует поддерево с новыми идентификаторами одним набором и выделяет копию
     */
    it('tree_copyPaste_copiesSubtreeInOneChangesetAndSelectsCopy', async () => {
        const user = userEvent.setup();
        const { api, controller } = await renderTree(family);

        await rightClick(user, 'Папка');
        await user.click(screen.getByRole('menuitem', { name: 'Копировать' }));
        await rightClick(user, 'Другая');
        await user.click(screen.getByRole('menuitem', { name: 'Вставить' }));

        expect(api.changesets).toHaveLength(1);
        const [copy] = controller.getChildren('g');
        expect(copy).toMatchObject({ type: 'Folder', properties: { name: 'Папка' } });
        expect(copy.id).not.toBe('f');
        expect(controller.getChildren(copy.id).map((c) => c.properties.name)).toEqual(['А', 'Б']);
        expect(controller.getObject('f')).toBeDefined();
        expect(selected()).toBe(copy.id);
        expect(primary()).toBe(copy.id);
        expect(names()).toContain('Папка');
    });

    /**
     * Проверяет, что вставка недоступна под узел, где скопированный тип не допускается
     */
    it('tree_pasteUnderNodeWithoutAllowedType_isDisabled', async () => {
        const user = userEvent.setup();
        await renderTree(family);
        await rightClick(user, 'Папка');
        await user.click(screen.getByRole('menuitem', { name: 'Копировать' }));

        await rightClick(user, 'Лист');

        expect(screen.getByRole('menuitem', { name: 'Вставить' })).toBeDisabled();
    });

    /**
     * Проверяет, что ссылки внутри копии перенаправляются на копии, а внешние остаются
     */
    it('tree_paste_redirectsReferencesInsideCopyAndKeepsExternalOnes', async () => {
        const user = userEvent.setup();
        const objects = [
            obj('f', 'Folder', null, 0, 'Папка'),
            obj('a', 'Note', 'f', 1, 'А'),
            { id: 'in', type: 'Link', parent: 'f', order: 2, properties: { target: 'a' } },
            { id: 'out', type: 'Link', parent: 'f', order: 3, properties: { target: 'l' } },
            obj('g', 'Folder', null, 1, 'Другая'),
            obj('l', 'Note', null, 2, 'Лист'),
        ];
        const { controller } = await renderTree(objects);

        await rightClick(user, 'Папка');
        await user.click(screen.getByRole('menuitem', { name: 'Копировать' }));
        await rightClick(user, 'Другая');
        await user.click(screen.getByRole('menuitem', { name: 'Вставить' }));

        const [copy] = controller.getChildren('g');
        const [note, inside, outside] = controller.getChildren(copy.id);
        expect(inside.properties.target).toBe(note.id);
        expect(note.id).not.toBe('a');
        expect(outside.properties.target).toBe('l');
    });

    /**
     * Проверяет, что Ctrl+C и Ctrl+V работают с клавиатуры, в том числе в русской раскладке
     */
    it('tree_ctrlCAndCtrlV_copyAndPasteInAnyKeyboardLayout', async () => {
        const user = userEvent.setup();
        const { controller } = await renderTree(family);

        await user.click(item('Лист'));
        fireEvent.keyDown(item('Лист'), { key: 'с', code: 'KeyC', ctrlKey: true });
        await user.click(item('Другая'));
        fireEvent.keyDown(item('Другая'), { key: 'м', code: 'KeyV', ctrlKey: true });

        await vi.waitFor(() => expect(controller.getChildren('g')).toHaveLength(1));
        expect(controller.getChildren('g')[0]).toMatchObject({ type: 'Note' });
        expect(controller.getObject('l')).toBeDefined();
    });

    /**
     * Проверяет, что копируется вся выделенная группа, а узел с выделенным предком не дублируется
     */
    it('tree_copyGroup_copiesAllSelectedAndSkipsNodesInsideSelectedSubtree', async () => {
        const user = userEvent.setup();
        const { controller } = await renderTree(family);
        await user.click(screen.getAllByRole('button', { name: 'Развернуть' })[0]);

        await user.click(item('Папка'));
        await user.keyboard('{Control>}');
        await user.click(item('А'));
        await user.click(item('Лист'));
        await user.keyboard('{/Control}');
        await rightClick(user, 'Лист');
        await user.click(screen.getByRole('menuitem', { name: 'Копировать' }));
        await rightClick(user, 'Другая');
        await user.click(screen.getByRole('menuitem', { name: 'Вставить' }));

        const copies = controller.getChildren('g');
        expect(copies.map((c) => c.type)).toEqual(['Folder', 'Note']);
        expect(controller.getChildren(copies[0].id)).toHaveLength(2);
        expect(selected()).toBe(
            copies
                .map((c) => c.id)
                .sort()
                .join(','),
        );
    });
});

/**
 * Дерево: команды для группы
 */
describe('Tree: commands for a group', () => {
    /**
     * Проверяет, что в меню группы нет создания и вставки, а правый клик вне выделения сбрасывает его
     */
    it('tree_groupMenu_hasNoCreateAndPasteAndRightClickOutsideResetsSelection', async () => {
        const user = userEvent.setup();
        await renderTree(family);
        await user.click(item('Папка'));
        await user.keyboard('{Control>}');
        await user.click(item('Лист'));
        await user.keyboard('{/Control}');

        await rightClick(user, 'Лист');
        expect(menuLabels()).toEqual(['Копировать', '—', 'Открыть', '—', 'Удалить']);
        expect(selected()).toBe('f,l');
        await user.keyboard('{Escape}');

        await rightClick(user, 'Другая');
        expect(selected()).toBe('g');
    });

    /**
     * Проверяет, что действие запускается для каждого объекта группы
     */
    it('tree_groupAction_runsForEverySelectedObject', async () => {
        const user = userEvent.setup();
        const { opened } = await renderTree(family);
        await user.click(item('Папка'));
        await user.keyboard('{Control>}');
        await user.click(item('Лист'));
        await user.click(item('Другая'));
        await user.keyboard('{/Control}');

        await rightClick(user, 'Лист');
        await user.click(screen.getByRole('menuitem', { name: 'Открыть' }));

        await vi.waitFor(() => expect(opened.sort()).toEqual(['f', 'g', 'l']));
    });

    /**
     * Проверяет, что действие, которого нет у типа одного из объектов, в меню группы не показывается
     */
    it('tree_groupAction_hiddenWhenNotAvailableForEveryType', async () => {
        const user = userEvent.setup();
        const objects = [...family, obj('k', 'Link', null, 3, 'Ссыль')];
        await renderTree(objects);
        await user.click(item('Лист'));
        await user.keyboard('{Control>}');
        await user.click(item('Ссыль'));
        await user.keyboard('{/Control}');

        await rightClick(user, 'Ссыль');

        expect(menuLabels()).toEqual(['Копировать', '—', 'Удалить']);
    });

    /**
     * Проверяет, что удаление группы просит одно подтверждение и выполняется одним набором
     */
    it('tree_deleteGroup_asksOnceAndRemovesAllInOneChangeset', async () => {
        const user = userEvent.setup();
        const { api, controller } = await renderTree(family);
        await user.click(screen.getAllByRole('button', { name: 'Развернуть' })[0]);
        await user.click(item('Папка'));
        await user.keyboard('{Control>}');
        await user.click(item('А'));
        await user.click(item('Лист'));
        await user.keyboard('{/Control}');

        await rightClick(user, 'Лист');
        await user.click(screen.getByRole('menuitem', { name: 'Удалить' }));
        const dialog = screen.getByRole('alertdialog');
        expect(dialog).toHaveTextContent('(2)');
        await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));

        expect(api.changesets).toHaveLength(1);
        expect(controller.getObject('f')).toBeUndefined();
        expect(controller.getObject('a')).toBeUndefined();
        expect(controller.getObject('l')).toBeUndefined();
        expect(controller.getObject('g')).toBeDefined();
        expect(selected()).toBe('');
        expect(names()).toEqual(['Другая']);
    });

    /**
     * Проверяет, что клавиша Delete открывает подтверждение удаления выделенной группы
     */
    it('tree_deleteKey_asksConfirmationForSelectedGroup', async () => {
        const user = userEvent.setup();
        const { controller } = await renderTree(family);
        await user.click(item('Другая'));
        await user.keyboard('{Control>}');
        await user.click(item('Лист'));
        await user.keyboard('{/Control}');

        await user.keyboard('{Delete}');
        const dialog = screen.getByRole('alertdialog');
        expect(dialog).toHaveTextContent('(2)');
        await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));

        expect(controller.getObject('g')).toBeUndefined();
        expect(controller.getObject('l')).toBeUndefined();
        expect(names()).toEqual(['Папка']);
    });
});
