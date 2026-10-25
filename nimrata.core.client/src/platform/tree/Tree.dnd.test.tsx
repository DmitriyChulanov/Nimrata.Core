import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '../data/DataController';
import { DataProvider } from '../data/DataProvider';
import { createFakeApi } from '../data/fakeApi';
import { SelectionProvider } from '../selection/SelectionProvider';
import { Tree } from './Tree';

const types = [
    {
        id: 'Folder',
        name: 'Папка',
        module: 't',
        moduleVersion: 1,
        icon: '📁',
        allowedChildren: ['Note', 'Folder'],
    },
    { id: 'Note', name: 'Заметка', module: 't', moduleVersion: 1, icon: '📝' },
    {
        id: 'Sealed',
        name: 'Закрытая',
        module: 't',
        moduleVersion: 1,
        allowedChildren: [],
    },
];

function obj(id: string, type: string, parent: string | null, order: number, name: string) {
    return { id, type, parent, order, properties: { name } };
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

/** Тянет строку на строку; `y` — смещение указателя внутри целевой строки (высота 24). */
function drag(source: string, target: string, y: number) {
    // jsdom не знает DragEvent и теряет clientY, поэтому задаём его вручную.
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

describe('Tree: перенос перетаскиванием', () => {
    it('перетаскивание узла на середину другого делает его потомком одним набором', async () => {
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

    it('перетаскивание в верхнюю часть строки ставит узел перед соседом', async () => {
        await renderTree(scene());

        drag('Лист', 'Группа', 2);

        await waitFor(() => expect(names()).toEqual(['Папка', 'Лист', 'Группа', 'Заметка']));
    });

    it('перетаскивание в нижнюю часть строки ставит узел после соседа', async () => {
        await renderTree(scene());

        drag('Папка', 'Заметка', 22);

        await waitFor(() => expect(names()).toEqual(['Группа', 'Заметка', 'Папка', 'Лист']));
    });

    it('перенос между соседями другого родителя меняет и родителя, и порядок', async () => {
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

    it('не принимает drop на тип, который не разрешает такого потомка', async () => {
        const { api } = await renderTree(scene());

        drag('Папка', 'Заметка', 12);

        expect(api.changesets).toEqual([]);
        expect(names()).toEqual(['Папка', 'Группа', 'Заметка', 'Лист']);
    });

    it('не принимает перенос в самого себя и в собственного потомка', async () => {
        const { api } = await renderTree([...scene(), obj('c', 'Folder', 'f', 0, 'Вложенная')]);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Развернуть' }));

        drag('Папка', 'Папка', 12);
        drag('Папка', 'Вложенная', 12);
        drag('Папка', 'Вложенная', 22);

        expect(api.changesets).toEqual([]);
    });

    it('подсвечивает недоступную цель как недоступную, допустимую — нет', async () => {
        await renderTree(scene());

        fireEvent.dragStart(item('Папка'));
        fireEvent.dragOver(item('Заметка'), { clientY: 12 });
        expect(item('Заметка')).toHaveAttribute('aria-disabled', 'true');

        fireEvent.dragOver(item('Группа'), { clientY: 12 });
        expect(item('Группа')).not.toHaveAttribute('aria-disabled');
        expect(item('Заметка')).not.toHaveAttribute('aria-disabled');
    });

    it('при отказе сервера возвращает дерево в исходное состояние и показывает сообщение', async () => {
        const { api } = await renderTree(scene());
        api.rejectNext(400, 'Сервер отказал');

        drag('Заметка', 'Папка', 12);

        expect(await screen.findByRole('alert')).toHaveTextContent('Сервер отказал');
        expect(names()).toEqual(['Папка', 'Группа', 'Заметка', 'Лист']);
    });
});

describe('Tree: перенос с клавиатуры', () => {
    it('Alt+↓ и Alt+↑ меняют порядок среди соседей', async () => {
        const user = userEvent.setup();
        const { api } = await renderTree(scene());

        item('Папка').focus();
        await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
        await waitFor(() => expect(names()).toEqual(['Группа', 'Папка', 'Заметка', 'Лист']));
        expect(api.changesets).toHaveLength(1);

        await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
        await waitFor(() => expect(names()).toEqual(['Папка', 'Группа', 'Заметка', 'Лист']));
    });

    it('Alt+→ делает узел потомком предыдущего соседа, Alt+← выносит на уровень выше', async () => {
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

    it('недопустимый перенос с клавиатуры ничего не делает', async () => {
        const user = userEvent.setup();
        const { api } = await renderTree(scene());

        item('Лист').focus();
        await user.keyboard('{Alt>}{ArrowRight}{/Alt}');

        expect(api.changesets).toEqual([]);
    });
});
