import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { DataProvider } from '@platform/data/DataProvider';
import { createFakeApi } from '@platform/data/fakeApi';
import { SelectionProvider } from '@platform/selection/SelectionProvider';
import { useSelection } from '@platform/selection/useSelection';

import { PropertyGrid } from './PropertyGrid';

const types = [
    {
        id: 'Task',
        name: 'Задача',
        extension: 't',
        extensionVersion: 1,
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
        extension: 't',
        extensionVersion: 1,
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

/**
 * Таблица свойств: отображение
 */
describe('PropertyGrid: rendering', () => {
    /**
     * Проверяет, что без выделенного объекта предлагается выбрать объект
     */
    it('propertyGrid_noSelectedObject_suggestsSelectingObject', async () => {
        await renderGrid(null);

        expect(screen.getByText('Объект не выбран.')).toBeInTheDocument();
    });

    /**
     * Проверяет, что заголовок категории вставляется при её смене в порядке описания типа
     */
    it('propertyGrid_properties_sectionedByCategoryChangeInTypeDescriptionOrder', async () => {
        await renderGrid();

        const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
        // Порядок сквозной: «Код» (Расчёт) стоит после «Срока», поэтому категория повторяется
        expect(groups).toEqual(['Основное', 'Расчёт', 'Срок', 'Расчёт', 'Прочее']);
        const main = screen.getByRole('group', { name: 'Основное' });
        expect(within(main).getByLabelText('Название')).toHaveValue('Первая');
        expect(within(main).getByLabelText('Описание')).toHaveValue('');
    });

    /**
     * Проверяет, что ссылочное свойство показывается как текст только для чтения
     */
    it('propertyGrid_referenceProperty_shownAsReadOnlyText', async () => {
        await renderGrid();

        const group = screen.getByRole('group', { name: 'Прочее' });
        expect(within(group).getByText('Владелец')).toBeInTheDocument();
        expect(within(group).getByText('Иван')).toBeInTheDocument();
        expect(within(group).queryByRole('textbox')).not.toBeInTheDocument();
    });

    /**
     * Проверяет, что свойство только для чтения не редактируется
     */
    it('propertyGrid_readOnlyProperty_isNotEditable', async () => {
        const { api } = await renderGrid();

        const code = screen.getByLabelText('Код');
        expect(code).toBeDisabled();
        await userEvent.type(code, 'x');
        expect(api.changesets).toHaveLength(0);
    });
});

/**
 * Таблица свойств: редактирование
 */
describe('PropertyGrid: editing', () => {
    /**
     * Проверяет, что `Enter` в строковом поле отправляет набор «было — стало»
     */
    it('propertyGrid_string_enterSendsChangesetOldToNew', async () => {
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

    /**
     * Проверяет, что потеря фокуса многострочным текстом отправляет изменение
     */
    it('propertyGrid_multilineText_blurSendsChange', async () => {
        const { api } = await renderGrid();

        await userEvent.type(screen.getByLabelText('Описание'), 'строка 1{Enter}строка 2');
        await userEvent.tab();

        expect(api.changesets[0].operations[0]).toMatchObject({
            changes: { descr: { old: null, new: 'строка 1\nстрока 2' } },
        });
    });

    /**
     * Проверяет, что целое отправляется числом, а нецелое не отправляется и показывает ошибку
     */
    it('propertyGrid_integer_sentAsNumberNonIntegerNotSentAndShowsError', async () => {
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

    /**
     * Проверяет, что щелчок по флажку переключает значение
     */
    it('propertyGrid_boolean_checkboxClickTogglesValue', async () => {
        const { api } = await renderGrid();

        await userEvent.click(screen.getByLabelText('Готово'));

        expect(api.changesets[0].operations[0]).toMatchObject({
            changes: { done: { old: false, new: true } },
        });
        expect(screen.getByLabelText('Готово')).toBeChecked();
    });

    /**
     * Проверяет, что дата вводится как ГГГГ-ММ-ДД
     */
    it('propertyGrid_date_enteredAsYyyyMmDd', async () => {
        const { api } = await renderGrid();

        await userEvent.type(screen.getByLabelText('День'), '2026-03-15');
        await userEvent.tab();

        expect(api.changesets[0].operations[0]).toMatchObject({
            changes: { day: { old: null, new: '2026-03-15' } },
        });
    });

    /**
     * Проверяет, что время вводится как ЧЧ:мм
     */
    it('propertyGrid_time_enteredAsHhMm', async () => {
        const { api } = await renderGrid();

        await userEvent.type(screen.getByLabelText('Время'), '09:30');
        await userEvent.tab();

        expect(api.changesets[0].operations[0]).toMatchObject({
            changes: { at: { old: null, new: '09:30' } },
        });
    });

    /**
     * Проверяет, что значение перечисления выбирается из списка, а пустой выбор очищает его
     */
    it('propertyGrid_enum_selectsValueFromListEmptyChoiceClearsValue', async () => {
        const { api } = await renderGrid();
        const select = screen.getByLabelText('Приоритет');

        await userEvent.selectOptions(select, 'Высокий');
        await userEvent.selectOptions(select, '');

        expect(api.changesets.map((c) => c.operations[0])).toMatchObject([
            { changes: { prio: { old: null, new: 'high' } } },
            { changes: { prio: { old: 'high', new: null } } },
        ]);
    });

    /**
     * Проверяет, что неизменённое значение не создаёт набор
     */
    it('propertyGrid_unchangedValue_createsNoChangeset', async () => {
        const { api } = await renderGrid();

        await userEvent.click(screen.getByLabelText('Название'));
        await userEvent.tab();

        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что отказ сервера возвращает значение и показывает причину
     */
    it('propertyGrid_serverRejection_revertsValueAndShowsReason', async () => {
        const { api } = await renderGrid();
        api.rejectNext(400, 'Название слишком длинное');

        const input = screen.getByLabelText('Название');
        await userEvent.clear(input);
        await userEvent.type(input, 'Новое{Enter}');

        expect(await screen.findByRole('alert')).toHaveTextContent('Название слишком длинное');
        expect(screen.getByLabelText('Название')).toHaveValue('Первая');
    });

    /**
     * Проверяет, что при отказе сервера флажок возвращается в прежнее положение
     */
    it('propertyGrid_serverRejection_checkboxReturnsToPreviousPosition', async () => {
        const { api } = await renderGrid();
        api.rejectNext(400, 'Нельзя завершить');

        await userEvent.click(screen.getByLabelText('Готово'));

        expect(await screen.findByRole('alert')).toHaveTextContent('Нельзя завершить');
        expect(screen.getByLabelText('Готово')).not.toBeChecked();
    });

    /**
     * Проверяет, что смена выделенного объекта показывает его свойства
     */
    it('propertyGrid_selectedObjectChange_showsItsProperties', async () => {
        await renderGrid();

        await userEvent.click(screen.getByRole('button', { name: 'выбрать p' }));

        expect(screen.getByLabelText('Имя')).toHaveValue('Иван');
        expect(screen.queryByLabelText('Название')).not.toBeInTheDocument();
    });
});

function RequestNameEdit({ id }: { id: string }) {
    const { select, requestNameEdit } = useSelection();
    return (
        <button
            type="button"
            onClick={() => {
                select(id);
                requestNameEdit(id);
            }}
        >
            создан {id}
        </button>
    );
}

/**
 * Таблица свойств: «Имя» и «Название»
 */
describe('PropertyGrid: name and title', () => {
    async function renderWithRequest() {
        const api = createFakeApi(types, objects);
        const controller = createDataController({ api });
        await controller.load();
        controller.registerTitle('Person', (o) => `Гражданин ${String(o.properties.name ?? '')}`);
        render(
            <DataProvider controller={controller}>
                <SelectionProvider>
                    <RequestNameEdit id="p" />
                    <Select id="t" />
                    <Select id="p" />
                    <PropertyGrid />
                </SelectionProvider>
            </DataProvider>,
        );
    }

    /**
     * Проверяет, что после запроса на правку фокус встаёт в редактируемое «Имя» и не возвращается
     * при повторном выделении объекта
     */
    it('propertyGrid_nameEditRequest_focusesNameOnceOnly', async () => {
        await renderWithRequest();

        await userEvent.click(screen.getByRole('button', { name: 'создан p' }));
        expect(screen.getByLabelText('Имя')).toHaveFocus();

        await userEvent.click(screen.getByRole('button', { name: 'выбрать t' }));
        await userEvent.click(screen.getByRole('button', { name: 'выбрать p' }));
        expect(screen.getByLabelText('Имя')).not.toHaveFocus();
    });

    /**
     * Проверяет, что у типа с формирователем есть строка «Название» только для чтения
     */
    it('propertyGrid_typeWithFormatter_showsReadOnlyTitleRow', async () => {
        await renderWithRequest();

        await userEvent.click(screen.getByRole('button', { name: 'создан p' }));

        expect(screen.getByLabelText('Название')).toHaveValue('Гражданин Иван');
        expect(screen.getByLabelText('Название')).toBeDisabled();
    });

    /**
     * Проверяет, что у типа без формирователя строки «Название» нет, а у задачи это обычное свойство
     */
    it('propertyGrid_typeWithoutFormatter_hasNoTitleRow', async () => {
        await renderWithRequest();
        await userEvent.click(screen.getByRole('button', { name: 'выбрать t' }));

        expect(screen.getAllByLabelText('Название')).toHaveLength(1);
        expect(screen.getByLabelText('Название')).toHaveValue('Первая');
        expect(screen.getByLabelText('Название')).toBeEnabled();
    });
});
