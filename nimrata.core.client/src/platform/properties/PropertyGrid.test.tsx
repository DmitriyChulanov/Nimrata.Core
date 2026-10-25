import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '../data/DataController';
import { DataProvider } from '../data/DataProvider';
import { createFakeApi } from '../data/fakeApi';
import { SelectionProvider, useSelection } from '../selection/SelectionProvider';
import { PropertyGrid } from './PropertyGrid';

const types = [
    {
        id: 'Task',
        name: 'Задача',
        module: 't',
        moduleVersion: 1,
        properties: [
            { id: 'title', name: 'Название', kind: 'string', category: 'Основное' },
            { id: 'descr', name: 'Описание', kind: 'text', category: 'Основное' },
            { id: 'count', name: 'Количество', kind: 'integer', category: 'Расчёт' },
            { id: 'done', name: 'Готово', kind: 'boolean', category: 'Расчёт' },
            { id: 'day', name: 'День', kind: 'date', category: 'Срок' },
            { id: 'at', name: 'Время', kind: 'time', category: 'Срок' },
            {
                id: 'prio',
                name: 'Приоритет',
                kind: 'enum',
                category: 'Срок',
                values: [
                    { value: 'low', name: 'Низкий' },
                    { value: 'high', name: 'Высокий' },
                ],
            },
            { id: 'code', name: 'Код', kind: 'string', category: 'Расчёт', readOnly: true },
            { id: 'owner', name: 'Владелец', kind: 'reference', targetTypes: ['Person'] },
        ],
    },
    {
        id: 'Person',
        name: 'Человек',
        module: 't',
        moduleVersion: 1,
        properties: [{ id: 'name', name: 'Имя', kind: 'string' }],
    },
];

const objects = [
    { id: 'p', type: 'Person', parent: null, order: 0, properties: { name: 'Иван' } },
    {
        id: 't',
        type: 'Task',
        parent: null,
        order: 1,
        properties: { title: 'Первая', code: 'A-1', owner: 'p', count: 5, done: false },
    },
];

function Select({ id }: { id: string | null }) {
    const { select } = useSelection();
    return (
        <button type="button" onClick={() => select(id)}>
            выбрать {id}
        </button>
    );
}

async function renderGrid(selected: string | null = 't') {
    const api = createFakeApi(types, objects);
    const controller = createDataController({ api });
    await controller.load();
    render(
        <DataProvider controller={controller}>
            <SelectionProvider>
                <Select id="t" />
                <Select id="p" />
                <PropertyGrid />
            </SelectionProvider>
        </DataProvider>,
    );
    if (selected)
        await userEvent.click(screen.getByRole('button', { name: `выбрать ${selected}` }));
    return { api, controller };
}

describe('PropertyGrid: отрисовка', () => {
    it('без выбранного объекта подсказывает выбрать объект', async () => {
        await renderGrid(null);

        expect(screen.getByText('Объект не выбран.')).toBeInTheDocument();
    });

    it('группирует свойства по категориям в порядке описания типа', async () => {
        await renderGrid();

        const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
        expect(groups).toEqual(['Основное', 'Расчёт', 'Срок', 'Прочее']);
        const main = screen.getByRole('group', { name: 'Основное' });
        expect(within(main).getByLabelText('Название')).toHaveValue('Первая');
        expect(within(main).getByLabelText('Описание')).toHaveValue('');
    });

    it('показывает ссылочное свойство текстом только для чтения', async () => {
        await renderGrid();

        const group = screen.getByRole('group', { name: 'Прочее' });
        expect(within(group).getByText('Владелец')).toBeInTheDocument();
        expect(within(group).getByText('Иван')).toBeInTheDocument();
        expect(within(group).queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('свойство «только чтение» недоступно для правки', async () => {
        const { api } = await renderGrid();

        const code = screen.getByLabelText('Код');
        expect(code).toBeDisabled();
        await userEvent.type(code, 'x');
        expect(api.changesets).toHaveLength(0);
    });
});

describe('PropertyGrid: правка', () => {
    it('строка: Enter отправляет набор изменений «было → стало»', async () => {
        const { api, controller } = await renderGrid();

        const input = screen.getByLabelText('Название');
        await userEvent.clear(input);
        await userEvent.type(input, 'Вторая{Enter}');

        expect(api.changesets).toHaveLength(1);
        expect(api.changesets[0].operations).toEqual([
            { op: 'update', id: 't', changes: { title: { old: 'Первая', new: 'Вторая' } } },
        ]);
        expect(controller.getObject('t')?.properties.title).toBe('Вторая');
    });

    it('многострочный текст: уход фокуса отправляет изменение', async () => {
        const { api } = await renderGrid();

        await userEvent.type(screen.getByLabelText('Описание'), 'строка 1{Enter}строка 2');
        await userEvent.tab();

        expect(api.changesets[0].operations[0]).toMatchObject({
            changes: { descr: { old: null, new: 'строка 1\nстрока 2' } },
        });
    });

    it('целое число: отправляется числом; нецелое не отправляется и показывает ошибку', async () => {
        const { api } = await renderGrid();
        const input = screen.getByLabelText('Количество');

        await userEvent.clear(input);
        await userEvent.type(input, '2.5{Enter}');
        expect(api.changesets).toHaveLength(0);
        expect(screen.getByRole('alert')).toHaveTextContent('Количество');

        await userEvent.clear(input);
        await userEvent.type(input, '12{Enter}');
        expect(api.changesets[0].operations[0]).toMatchObject({
            changes: { count: { old: 5, new: 12 } },
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('логическое: щелчок по флажку переключает значение', async () => {
        const { api } = await renderGrid();

        await userEvent.click(screen.getByLabelText('Готово'));

        expect(api.changesets[0].operations[0]).toMatchObject({
            changes: { done: { old: false, new: true } },
        });
        expect(screen.getByLabelText('Готово')).toBeChecked();
    });

    it('дата: вводится как YYYY-MM-DD', async () => {
        const { api } = await renderGrid();

        await userEvent.type(screen.getByLabelText('День'), '2026-03-15');
        await userEvent.tab();

        expect(api.changesets[0].operations[0]).toMatchObject({
            changes: { day: { old: null, new: '2026-03-15' } },
        });
    });

    it('время: вводится как HH:mm', async () => {
        const { api } = await renderGrid();

        await userEvent.type(screen.getByLabelText('Время'), '09:30');
        await userEvent.tab();

        expect(api.changesets[0].operations[0]).toMatchObject({
            changes: { at: { old: null, new: '09:30' } },
        });
    });

    it('перечисление: выбор значения из списка; пустой выбор снимает значение', async () => {
        const { api } = await renderGrid();
        const select = screen.getByLabelText('Приоритет');

        await userEvent.selectOptions(select, 'Высокий');
        await userEvent.selectOptions(select, '');

        expect(api.changesets.map((c) => c.operations[0])).toMatchObject([
            { changes: { prio: { old: null, new: 'high' } } },
            { changes: { prio: { old: 'high', new: null } } },
        ]);
    });

    it('неизменённое значение набор не создаёт', async () => {
        const { api } = await renderGrid();

        await userEvent.click(screen.getByLabelText('Название'));
        await userEvent.tab();

        expect(api.changesets).toHaveLength(0);
    });

    it('при отказе сервера значение откатывается и показывается причина', async () => {
        const { api } = await renderGrid();
        api.rejectNext(400, 'Название слишком длинное');

        const input = screen.getByLabelText('Название');
        await userEvent.clear(input);
        await userEvent.type(input, 'Новое{Enter}');

        expect(await screen.findByRole('alert')).toHaveTextContent('Название слишком длинное');
        expect(screen.getByLabelText('Название')).toHaveValue('Первая');
    });

    it('при отказе флажок возвращается в прежнее положение', async () => {
        const { api } = await renderGrid();
        api.rejectNext(400, 'Нельзя завершить');

        await userEvent.click(screen.getByLabelText('Готово'));

        expect(await screen.findByRole('alert')).toHaveTextContent('Нельзя завершить');
        expect(screen.getByLabelText('Готово')).not.toBeChecked();
    });

    it('при смене выбранного объекта показывает его свойства', async () => {
        await renderGrid();

        await userEvent.click(screen.getByRole('button', { name: 'выбрать p' }));

        expect(screen.getByLabelText('Имя')).toHaveValue('Иван');
        expect(screen.queryByLabelText('Название')).not.toBeInTheDocument();
    });
});
