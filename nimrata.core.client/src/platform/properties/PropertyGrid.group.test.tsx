import { render, screen } from '@testing-library/react';
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
            { id: 'title', name: 'Название', kind: 'string', category: 'Основное', order: 20 },
            { id: 'done', name: 'Готово', kind: 'boolean', category: 'Основное', order: 30 },
            {
                id: 'prio',
                name: 'Приоритет',
                kind: 'enum',
                category: 'Основное',
                values: [
                    { value: 'low', name: 'Низкий' },
                    { value: 'high', name: 'Высокий' },
                ],
            },
            { id: 'only', name: 'Только задача', kind: 'string', category: 'Основное' },
        ],
        actions: [
            { id: 'finish', name: 'Завершить', placements: ['propertyGrid'], order: 10 },
            {
                id: 'later',
                name: 'Отложить',
                placements: ['propertyGrid'],
                category: 'Основное',
                order: 40,
            },
        ],
    },
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        properties: [
            { id: 'title', name: 'Название', kind: 'string', category: 'Основное' },
            { id: 'done', name: 'Готово', kind: 'boolean', category: 'Основное' },
        ],
        actions: [{ id: 'finish', name: 'Завершить', placements: ['propertyGrid'] }],
    },
];

const objects = [
    {
        id: 'a',
        type: 'Task',
        parent: null,
        number: 0,
        properties: { title: 'Одна', done: true, prio: 'low' },
    },
    {
        id: 'b',
        type: 'Task',
        parent: null,
        number: 1,
        properties: { title: 'Одна', done: false, prio: 'low' },
    },
    { id: 'n', type: 'Note', parent: null, number: 2, properties: { title: 'Одна' } },
];

function Pick({ ids }: { ids: string[] }) {
    const { setSelection } = useSelection();
    return (
        <button type="button" onClick={() => setSelection(ids, ids[0]!)}>
            выделить {ids.join('+')}
        </button>
    );
}

async function renderGroup(ids: string[]) {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    const finished: string[] = [];
    data.registerAction('Task', 'finish', (ctx) => {
        finished.push(ctx.object.id);
        ctx.tx.setProperty(ctx.object.id, 'title', 'Готово');
    });
    data.registerAction('Task', 'later', () => {});
    data.registerAction('Note', 'finish', (ctx) => {
        finished.push(ctx.object.id);
    });
    render(
        <DataProvider controller={data}>
            <SelectionProvider>
                <Pick ids={ids} />
                <PropertyGrid />
            </SelectionProvider>
        </DataProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: `выделить ${ids.join('+')}` }));
    return { api, data, finished };
}

/**
 * Таблица свойств: группа выделенных объектов
 */
describe('PropertyGrid: group selection', () => {
    /**
     * Проверяет, что показаны только общие свойства, а разные значения — как «Различны»
     */
    it('propertyGrid_group_showsCommonPropertiesAndMixedValues', async () => {
        await renderGroup(['a', 'b']);

        expect(screen.getByLabelText('Название')).toHaveValue('Одна');
        expect(screen.getByLabelText('Готово')).toBePartiallyChecked();
        expect(screen.getByText('Различны')).toBeInTheDocument();
        expect(screen.getByLabelText('Приоритет')).toHaveValue('low');
        expect(screen.queryByText('Только задача')).toBeInTheDocument();
    });

    /**
     * Проверяет, что для объектов разных типов остаются свойства, общие по идентификатору и виду
     */
    it('propertyGrid_groupOfDifferentTypes_showsOnlyCommonProperties', async () => {
        await renderGroup(['a', 'n']);

        expect(screen.getByLabelText('Название')).toBeInTheDocument();
        expect(screen.queryByLabelText('Приоритет')).not.toBeInTheDocument();
        expect(screen.queryByText('Только задача')).not.toBeInTheDocument();
    });

    /**
     * Проверяет, что правка записывается во все объекты одним набором и отменяется одним шагом
     */
    it('propertyGrid_groupEdit_writesAllObjectsInOneChangesetAndUndoStep', async () => {
        const { api, data } = await renderGroup(['a', 'b']);

        await userEvent.selectOptions(screen.getByLabelText('Приоритет'), 'high');

        expect(api.changesets).toHaveLength(1);
        expect(data.getObject('a')?.properties.prio).toBe('high');
        expect(data.getObject('b')?.properties.prio).toBe('high');
        await data.undo();
        expect(data.getObject('a')?.properties.prio).toBe('low');
        expect(data.getObject('b')?.properties.prio).toBe('low');
    });

    /**
     * Проверяет, что выбор значения вместо «Различны» записывается во все объекты, а равные пропускаются
     */
    it('propertyGrid_mixedBoolean_clickWritesTrueToAll', async () => {
        const { api, data } = await renderGroup(['a', 'b']);

        await userEvent.click(screen.getByLabelText('Готово'));

        expect(data.getObject('a')?.properties.done).toBe(true);
        expect(data.getObject('b')?.properties.done).toBe(true);
        expect(api.changesets[0]?.operations).toHaveLength(1);
    });

    /**
     * Проверяет, что действие группы запускается для каждого объекта по очереди
     */
    it('propertyGrid_groupAction_runsForEachObjectInOrder', async () => {
        const { finished } = await renderGroup(['b', 'a']);

        await userEvent.click(screen.getByRole('button', { name: 'Завершить' }));

        expect(finished).toEqual(['b', 'a']);
    });

    /**
     * Проверяет, что действие, которого нет у части объектов, не показывается
     */
    it('propertyGrid_groupAction_missingInOneType_isHidden', async () => {
        await renderGroup(['a', 'n']);

        expect(screen.getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Отложить' })).not.toBeInTheDocument();
    });

    /**
     * Проверяет сквозной порядок: действие с order стоит между свойствами по номеру
     */
    it('propertyGrid_throughOrder_mixesActionsAndProperties', async () => {
        await renderGroup(['a']);

        const labels = Array.from(
            document.querySelectorAll('.property-grid label, .property-grid button'),
        ).map((e) => e.textContent);
        expect(labels).toEqual([
            'Завершить',
            'Название',
            'Готово',
            'Отложить',
            'Приоритет',
            'Только задача',
            'Номер',
        ]);
    });
});
