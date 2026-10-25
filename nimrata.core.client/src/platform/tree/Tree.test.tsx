import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '../data/DataController';
import { DataProvider } from '../data/DataProvider';
import { createFakeApi } from '../data/fakeApi';
import { SelectionProvider, useSelection } from '../selection/SelectionProvider';
import { Tree } from './Tree';

const types = [
    {
        id: 'Folder',
        name: 'Папка',
        module: 't',
        moduleVersion: 1,
        icon: '📁',
        allowedChildren: ['Note', 'Folder', 'Base'],
    },
    { id: 'Note', name: 'Заметка', module: 't', moduleVersion: 1, icon: '📝' },
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

describe('Tree: отрисовка', () => {
    it('показывает корневые узлы с названием из свойства и иконкой типа', async () => {
        await renderTree([obj('r', 'Folder', null, 0, 'Мои папки')]);

        const item = screen.getByRole('treeitem', { name: 'Мои папки' });
        expect(within(item).getByText('📁')).toBeInTheDocument();
    });

    it('без названия показывает название типа', async () => {
        await renderTree([obj('n', 'Note', null, 0)]);

        expect(screen.getByRole('treeitem', { name: 'Заметка' })).toBeInTheDocument();
    });

    it('сортирует узлы по порядку, затем по названию', async () => {
        await renderTree([
            obj('c', 'Note', null, 2, 'Аааа'),
            obj('b', 'Note', null, 1, 'Яблоко'),
            obj('a', 'Note', null, 1, 'Арбуз'),
        ]);

        expect(names()).toEqual(['Арбуз', 'Яблоко', 'Аааа']);
    });

    it('не показывает объекты типов с hiddenInTree', async () => {
        await renderTree([
            obj('h', 'Hidden', null, 0, 'Скрытый'),
            obj('n', 'Note', null, 1, 'Видимый'),
        ]);

        expect(names()).toEqual(['Видимый']);
    });
});

describe('Tree: виртуализация', () => {
    const many = Array.from({ length: 10000 }, (_, i) =>
        obj(`n${i}`, 'Note', null, i, `Заметка ${i}`),
    );

    it('большое дерево рисует только видимое окно строк', async () => {
        await renderTree(many);

        const rendered = screen.getAllByRole('treeitem').length;
        expect(rendered).toBeGreaterThan(0);
        expect(rendered).toBeLessThan(100);
        expect(screen.getByRole('treeitem', { name: 'Заметка 0' })).toHaveAttribute(
            'aria-setsize',
            '10000',
        );
    });

    it('при прокрутке подставляются строки из нужного места списка', async () => {
        await renderTree(many);

        fireEvent.scroll(screen.getByRole('tree'), { target: { scrollTop: 24 * 5000 } });

        expect(await screen.findByRole('treeitem', { name: 'Заметка 5000' })).toBeInTheDocument();
        expect(screen.queryByRole('treeitem', { name: 'Заметка 0' })).not.toBeInTheDocument();
    });
});

describe('Tree: контекстное меню', () => {
    const family = [
        obj('f', 'Folder', null, 0, 'Папка'),
        obj('a', 'Note', 'f', 1, 'А'),
        obj('l', 'Note', null, 1, 'Лист'),
    ];

    const menuItems = () => screen.getAllByRole('menuitem').map((i) => i.textContent);

    it('«Создать» предлагает только допустимые неабстрактные дочерние типы, затем «Удалить»', async () => {
        const user = userEvent.setup();
        await renderTree(family);

        await user.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: 'Папка' }),
        });

        expect(menuItems()).toEqual(['Создать: Заметка', 'Создать: Папка', 'Удалить']);
    });

    it('у типа без допустимых дочерних в меню только «Удалить»', async () => {
        const user = userEvent.setup();
        await renderTree(family);

        await user.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: 'Лист' }),
        });

        expect(menuItems()).toEqual(['Удалить']);
    });

    it('«Создать» добавляет дочерний объект набором изменений и показывает его в дереве', async () => {
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

    it('«Удалить» просит подтверждение; отмена ничего не меняет', async () => {
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

    it('подтверждённое удаление убирает объект вместе с потомками одним набором', async () => {
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

    it('отказ сервера показывается сообщением и дерево возвращается к прежнему виду', async () => {
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

    it('Escape закрывает меню', async () => {
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

describe('Tree: раскрытие и выделение', () => {
    const family = [
        obj('f', 'Folder', null, 0, 'Папка'),
        obj('b', 'Note', 'f', 2, 'Б'),
        obj('a', 'Note', 'f', 1, 'А'),
        obj('h', 'Hidden', 'f', 0, 'Скрытый'),
    ];

    it('потомки скрыты, пока узел не раскрыт; раскрытие и сворачивание кнопкой', async () => {
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

    it('у узла без видимых потомков нет кнопки раскрытия', async () => {
        await renderTree([obj('n', 'Note', null, 0, 'Лист'), obj('h', 'Hidden', 'n', 0)]);

        expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument();
    });

    it('клик по узлу выделяет объект, выделение доступно остальным панелям', async () => {
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
