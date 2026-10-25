import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '../data/DataController';
import { DataProvider } from '../data/DataProvider';
import { createFakeApi } from '../data/fakeApi';
import { PropertyGrid } from '../properties/PropertyGrid';
import { SelectionProvider, useSelection } from '../selection/SelectionProvider';
import { Tree } from '../tree/Tree';

const types = [
    {
        id: 'Folder',
        name: 'Папка',
        module: 't',
        moduleVersion: 1,
        allowedChildren: ['Job'],
    },
    {
        id: 'Job',
        name: 'Работа',
        module: 't',
        moduleVersion: 1,
        properties: [
            { id: 'name', name: 'Название', kind: 'string' },
            { id: 'status', name: 'Статус', kind: 'string' },
        ],
        actions: [
            { id: 'finish', name: 'Завершить', placements: ['propertyGrid', 'contextMenu'] },
            { id: 'gridOnly', name: 'Только в таблице', placements: ['propertyGrid'] },
            { id: 'menuOnly', name: 'Только в меню', placements: ['contextMenu'] },
            { id: 'auto', name: 'Автоматизация', placements: ['automation'] },
            {
                id: 'noHandler',
                name: 'Без обработчика',
                placements: ['propertyGrid', 'contextMenu'],
            },
            {
                id: 'defer',
                name: 'Отложить',
                placements: ['propertyGrid'],
                parameters: [
                    { id: 'days', name: 'Дней', kind: 'integer', required: true },
                    { id: 'note', name: 'Комментарий', kind: 'string' },
                    { id: 'text', name: 'Подробно', kind: 'text' },
                    { id: 'urgent', name: 'Срочно', kind: 'boolean' },
                    { id: 'on', name: 'Дата', kind: 'date' },
                    { id: 'at', name: 'Время', kind: 'time' },
                    {
                        id: 'level',
                        name: 'Уровень',
                        kind: 'enum',
                        values: [
                            { value: 'low', name: 'Низкий' },
                            { value: 'high', name: 'Высокий' },
                        ],
                    },
                    { id: 'who', name: 'Кому', kind: 'reference', targetTypes: ['Folder'] },
                ],
            },
        ],
    },
];

const objects = [
    { id: 'f', type: 'Folder', parent: null, order: 0, properties: { name: 'Входящие' } },
    { id: 'j', type: 'Job', parent: 'f', order: 0, properties: { name: 'Дело', status: 'new' } },
];

function Select({ id }: { id: string }) {
    const { select } = useSelection();
    return (
        <button type="button" onClick={() => select(id)}>
            выбрать {id}
        </button>
    );
}

async function setup() {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    const calls: Record<string, unknown>[] = [];
    data.registerAction('Job', 'finish', (ctx) => {
        ctx.tx.setProperty(ctx.object.id, 'status', 'done');
    });
    data.registerAction('Job', 'gridOnly', () => {});
    data.registerAction('Job', 'menuOnly', () => {});
    data.registerAction('Job', 'auto', () => {});
    data.registerAction('Job', 'defer', (ctx) => {
        calls.push(ctx.params);
        ctx.tx.setProperty(ctx.object.id, 'status', 'deferred');
    });
    render(
        <DataProvider controller={data}>
            <SelectionProvider>
                <Select id="j" />
                <Tree />
                <PropertyGrid />
            </SelectionProvider>
        </DataProvider>,
    );
    return { api, data, calls };
}

async function openJob() {
    await userEvent.click(screen.getByRole('button', { name: 'выбрать j' }));
}

async function expandAndContextMenu() {
    await userEvent.click(screen.getByRole('button', { name: 'Развернуть' }));
    await userEvent.pointer({
        keys: '[MouseRight]',
        target: screen.getByRole('treeitem', { name: 'Дело' }),
    });
    return screen.getByRole('menu', { name: 'Действия с объектом' });
}

describe('Действия в таблице свойств', () => {
    it('показывает кнопки действий с placement propertyGrid и обработчиком', async () => {
        await setup();
        await openJob();

        const bar = screen.getByRole('toolbar', { name: 'Действия' });
        const labels = within(bar)
            .getAllByRole('button')
            .map((b) => b.textContent);
        expect(labels).toEqual(['Завершить', 'Только в таблице', 'Отложить']);
    });

    it('кнопка без параметров запускает обработчик: один набор изменений, таблица обновляется', async () => {
        const { api } = await setup();
        await openJob();

        await userEvent.click(screen.getByRole('button', { name: 'Завершить' }));

        expect(api.changesets).toHaveLength(1);
        expect(screen.getByLabelText('Статус')).toHaveValue('done');
    });

    it('отмена хуком показывается сообщением и ничего не меняет', async () => {
        const { api, data } = await setup();
        data.registerHook('Job', 'setProperty', 'before', () => ({ cancel: 'Хук против.' }));
        await openJob();

        await userEvent.click(screen.getByRole('button', { name: 'Завершить' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Хук против.');
        expect(api.changesets).toHaveLength(0);
    });

    it('у объекта без действий панель действий не показывается', async () => {
        await setup();
        await userEvent.click(screen.getByRole('button', { name: 'Развернуть' }));
        await userEvent.click(screen.getByRole('treeitem', { name: 'Входящие' }));

        expect(screen.queryByRole('toolbar', { name: 'Действия' })).not.toBeInTheDocument();
    });
});

describe('Действия в контекстном меню дерева', () => {
    it('показывает пункты с placement contextMenu и обработчиком, рядом с «Удалить»', async () => {
        await setup();
        const menu = await expandAndContextMenu();

        const items = within(menu)
            .getAllByRole('menuitem')
            .map((i) => i.textContent);
        expect(items).toContain('Завершить');
        expect(items).toContain('Только в меню');
        expect(items).toContain('Удалить');
        expect(items).not.toContain('Только в таблице');
        expect(items).not.toContain('Автоматизация');
        expect(items).not.toContain('Без обработчика');
    });

    it('клик по пункту запускает действие над объектом узла', async () => {
        const { api, data } = await setup();
        const menu = await expandAndContextMenu();

        await userEvent.click(within(menu).getByRole('menuitem', { name: 'Завершить' }));

        expect(api.changesets).toHaveLength(1);
        expect(data.getObject('j')?.properties.status).toBe('done');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('отказ действия показывается сообщением', async () => {
        const { data } = await setup();
        data.registerHook('Job', 'setProperty', 'before', () => ({ cancel: 'Нельзя.' }));
        const menu = await expandAndContextMenu();

        await userEvent.click(within(menu).getByRole('menuitem', { name: 'Завершить' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Нельзя.');
    });
});

describe('Диалог параметров действия', () => {
    async function openDefer() {
        const ctx = await setup();
        await openJob();
        await userEvent.click(screen.getByRole('button', { name: 'Отложить' }));
        return { ...ctx, dialog: screen.getByRole('dialog', { name: 'Отложить' }) };
    }

    it('строит поля по восьми видам параметров', async () => {
        const { dialog } = await openDefer();

        expect(within(dialog).getByLabelText(/Дней/)).toHaveAttribute('inputmode', 'numeric');
        expect(within(dialog).getByLabelText('Комментарий')).toHaveAttribute('type', 'text');
        expect(within(dialog).getByLabelText('Подробно').tagName).toBe('TEXTAREA');
        expect(within(dialog).getByLabelText('Срочно')).toHaveAttribute('type', 'checkbox');
        expect(within(dialog).getByLabelText('Дата')).toHaveAttribute('type', 'date');
        expect(within(dialog).getByLabelText('Время')).toHaveAttribute('type', 'time');
        const level = within(dialog).getByLabelText('Уровень');
        expect(
            within(level)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['', 'Низкий', 'Высокий']);
        const who = within(dialog).getByLabelText('Кому');
        expect(
            within(who)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['', 'Входящие']);
    });

    it('не отправляет форму без обязательного параметра и показывает причину', async () => {
        const { api, calls, dialog } = await openDefer();

        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        expect(within(dialog).getByRole('alert')).toHaveTextContent('Параметр «Дней» обязателен.');
        expect(calls).toEqual([]);
        expect(api.changesets).toHaveLength(0);
    });

    it('передаёт обработчику собранные параметры и закрывается; пустые не передаются', async () => {
        const { api, calls, dialog } = await openDefer();

        await userEvent.type(within(dialog).getByLabelText(/Дней/), '3');
        await userEvent.type(within(dialog).getByLabelText('Комментарий'), 'позже');
        await userEvent.click(within(dialog).getByLabelText('Срочно'));
        await userEvent.selectOptions(within(dialog).getByLabelText('Уровень'), 'high');
        await userEvent.selectOptions(within(dialog).getByLabelText('Кому'), 'f');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        expect(calls).toEqual([{ days: 3, note: 'позже', urgent: true, level: 'high', who: 'f' }]);
        expect(api.changesets).toHaveLength(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('проверяет формат числа', async () => {
        const { calls, dialog } = await openDefer();

        await userEvent.type(within(dialog).getByLabelText(/Дней/), 'abc');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        expect(within(dialog).getByRole('alert')).toHaveTextContent('Дней');
        expect(calls).toEqual([]);
    });

    it('«Отмена» закрывает диалог без запуска', async () => {
        const { api, calls, dialog } = await openDefer();

        await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(calls).toEqual([]);
        expect(api.changesets).toHaveLength(0);
    });

    it('отказ хука при запуске показывается в диалоге, и диалог остаётся открытым', async () => {
        const { data, dialog } = await openDefer();
        data.registerHook('Job', 'setProperty', 'before', () => ({ cancel: 'Хук против.' }));

        await userEvent.type(within(dialog).getByLabelText(/Дней/), '1');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
            'Хук против.',
        );
    });
});
