import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { DataProvider } from '@platform/data/DataProvider';
import { createFakeApi } from '@platform/data/fakeApi';
import { SelectionProvider } from '@platform/selection/SelectionProvider';

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
    {
        id: 'Sealed',
        name: 'Закрытая',
        extension: 't',
        extensionVersion: 1,
        allowedChildren: [],
    },
];

function obj(id: string, type: string, parent: string | null, number: number, name: string) {
    return { id, type, parent, number, properties: { name } };
}

async function renderTree(objects: unknown[]) {
    const api = createFakeApi(types, objects);
    const controller = createDataController({ api });
    await controller.load();
    render(
        <DataProvider controller={controller}>
            <SelectionProvider>
                <Tree />
            </SelectionProvider>
        </DataProvider>,
    );
    return { api, controller };
}

const names = () => screen.getAllByRole('treeitem').map((n) => n.getAttribute('aria-label'));
const item = (name: string) => screen.getByRole('treeitem', { name });

/**
 * Тянет строку на строку; `y` — смещение указателя внутри целевой строки (высота 24)
 */
function drag(source: string, target: string, y: number) {
    // jsdom не знает DragEvent и теряет clientY, поэтому задаём его вручную
    const at = (create: typeof createEvent.dragOver) => {
        const event = create(item(target));
        Object.defineProperty(event, 'clientY', { value: y });
        fireEvent(item(target), event);
    };
    fireEvent.dragStart(item(source));
    at(createEvent.dragOver);
    at(createEvent.drop);
    fireEvent.dragEnd(item(source));
}

const scene = () => [
    obj('f', 'Folder', null, 0, 'Папка'),
    obj('g', 'Folder', null, 1, 'Группа'),
    obj('n', 'Note', null, 2, 'Заметка'),
    obj('m', 'Note', null, 3, 'Лист'),
];

/**
 * Дерево: перенос перетаскиванием
 */
describe('Tree: move by dragging', () => {
    /**
     * Проверяет, что сброс на середину другого узла делает объект его потомком одним набором
     */
    it('treeDnd_dropOnMiddleOfOtherNode_makesItDescendantInOneChangeset', async () => {
        const { api, controller } = await renderTree(scene());

        drag('Заметка', 'Папка', 12);

        await waitFor(() => expect(api.changesets).toHaveLength(1));
        expect(api.changesets[0].operations[0]).toMatchObject({
            op: 'move',
            id: 'n',
            parent: { old: null, new: 'f' },
        });
        expect(controller.getObject('n')?.parent).toBe('f');
    });

    /**
     * Проверяет, что сброс на верхнюю часть строки ставит узел перед соседом
     */
    it('treeDnd_dropOnUpperPartOfRow_placesNodeBeforeSibling', async () => {
        await renderTree(scene());

        drag('Лист', 'Группа', 2);

        await waitFor(() => expect(names()).toEqual(['Папка', 'Лист', 'Группа', 'Заметка']));
    });

    /**
     * Проверяет, что перенос «до» перенумеровывает коллекцию плотно одним набором изменений
     */
    it('treeDnd_dropBefore_renumbersCollectionDenselyInOneChangeset', async () => {
        const { api, controller } = await renderTree([
            obj('a', 'Note', null, 1, 'А'),
            obj('b', 'Note', null, 5, 'Б'),
            obj('c', 'Note', null, 5, 'В'),
        ]);

        drag('В', 'Б', 2);

        await waitFor(() => expect(names()).toEqual(['А', 'В', 'Б']));
        expect(['a', 'b', 'c'].map((id) => controller.getObject(id)?.number)).toEqual([1, 3, 2]);
        expect(api.changesets).toHaveLength(1);
    });

    /**
     * Проверяет, что сброс на нижнюю часть строки ставит узел после соседа
     */
    it('treeDnd_dropOnLowerPartOfRow_placesNodeAfterSibling', async () => {
        await renderTree(scene());

        drag('Папка', 'Заметка', 22);

        await waitFor(() => expect(names()).toEqual(['Группа', 'Заметка', 'Папка', 'Лист']));
    });

    /**
     * Проверяет, что перенос между соседями другого родителя меняет и родителя, и порядок
     */
    it('treeDnd_moveBetweenSiblingsOfOtherParent_changesBothParentAndOrder', async () => {
        const { controller } = await renderTree([
            ...scene(),
            obj('a', 'Note', 'f', 0, 'А'),
            obj('b', 'Note', 'f', 1, 'Б'),
        ]);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Развернуть' }));

        drag('Лист', 'А', 22);

        await waitFor(() => expect(controller.getObject('m')?.parent).toBe('f'));
        expect(names()).toEqual(['Папка', 'А', 'Лист', 'Б', 'Группа', 'Заметка']);
    });

    /**
     * Проверяет, что сброс на тип, не допускающий такого потомка, не принимается
     */
    it('treeDnd_dropOnTypeThatDisallowsSuchChild_isNotAccepted', async () => {
        const { api } = await renderTree(scene());

        drag('Папка', 'Заметка', 12);

        expect(api.changesets).toEqual([]);
        expect(names()).toEqual(['Папка', 'Группа', 'Заметка', 'Лист']);
    });

    /**
     * Проверяет, что перенос в себя и в собственного потомка не принимается
     */
    it('treeDnd_moveIntoSelfAndOwnDescendant_isNotAccepted', async () => {
        const { api } = await renderTree([...scene(), obj('c', 'Folder', 'f', 0, 'Вложенная')]);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Развернуть' }));

        drag('Папка', 'Папка', 12);
        drag('Папка', 'Вложенная', 12);
        drag('Папка', 'Вложенная', 22);

        expect(api.changesets).toEqual([]);
    });

    /**
     * Проверяет, что недоступная цель подсвечивается как недоступная, а допустимая — нет
     */
    it('treeDnd_unavailableTarget_isHighlightedAsUnavailableValidOneIsNot', async () => {
        await renderTree(scene());

        fireEvent.dragStart(item('Папка'));
        fireEvent.dragOver(item('Заметка'), { clientY: 12 });
        expect(item('Заметка')).toHaveAttribute('aria-disabled', 'true');

        fireEvent.dragOver(item('Группа'), { clientY: 12 });
        expect(item('Группа')).not.toHaveAttribute('aria-disabled');
        expect(item('Заметка')).not.toHaveAttribute('aria-disabled');
    });

    /**
     * Проверяет, что отказ сервера возвращает дерево и показывает сообщение
     */
    it('treeDnd_serverRejection_restoresTreeAndShowsMessage', async () => {
        const { api } = await renderTree(scene());
        api.rejectNext(400, 'Сервер отказал');

        drag('Заметка', 'Папка', 12);

        expect(await screen.findByRole('alert')).toHaveTextContent('Сервер отказал');
        expect(names()).toEqual(['Папка', 'Группа', 'Заметка', 'Лист']);
    });
});

/**
 * Дерево: перенос с клавиатуры
 */
describe('Tree: move by keyboard', () => {
    /**
     * Проверяет, что `Alt+↓` и `Alt+↑` меняют порядок среди соседей
     */
    it('treeKeyboard_altDownAndAltUp_changeOrderAmongSiblings', async () => {
        const user = userEvent.setup();
        const { api } = await renderTree(scene());

        item('Папка').focus();
        await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
        await waitFor(() => expect(names()).toEqual(['Группа', 'Папка', 'Заметка', 'Лист']));
        expect(api.changesets).toHaveLength(1);

        await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
        await waitFor(() => expect(names()).toEqual(['Папка', 'Группа', 'Заметка', 'Лист']));
    });

    /**
     * Проверяет, что `Alt+→` делает узел потомком предыдущего соседа, а `Alt+←` поднимает на уровень
     */
    it('treeKeyboard_altRight_makesNodeChildOfPreviousSiblingAltLeftMovesUpALevel', async () => {
        const user = userEvent.setup();
        const { controller } = await renderTree(scene());

        item('Группа').focus();
        await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
        await waitFor(() => expect(controller.getObject('g')?.parent).toBe('f'));

        item('Группа').focus();
        await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
        await waitFor(() => expect(controller.getObject('g')?.parent).toBeNull());
        expect(names()).toEqual(['Папка', 'Группа', 'Заметка', 'Лист']);
    });

    /**
     * Проверяет, что недопустимый перенос ничего не делает
     */
    it('treeKeyboard_invalidMove_doesNothing', async () => {
        const user = userEvent.setup();
        const { api } = await renderTree(scene());

        item('Лист').focus();
        await user.keyboard('{Alt>}{ArrowRight}{/Alt}');

        expect(api.changesets).toEqual([]);
    });
});
