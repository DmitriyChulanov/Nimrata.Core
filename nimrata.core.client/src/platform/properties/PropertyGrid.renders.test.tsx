import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
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
            { id: 'name', name: 'Имя', kind: 'string' },
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
    { id: 'p', type: 'Person', parent: null, number: 1, properties: { name: 'Иван' } },
    { id: 'q', type: 'Person', parent: null, number: 2, properties: { name: 'Пётр' } },
    { id: 't', type: 'Task', parent: null, number: 3, properties: { name: 'Т', owner: 'p' } },
];

/**
 * Кнопка выделения задачи `t`
 */
function SelectTask() {
    const { select } = useSelection();
    return (
        <button type="button" onClick={() => select('t')}>
            выбрать
        </button>
    );
}

/**
 * Таблица свойств, выделена задача `t`; считает фиксации отрисовок таблицы
 */
async function renderGrid() {
    const data = createDataController({ api: createFakeApi(types, objects) });
    await data.load();
    const commits = { count: 0 };
    render(
        <DataProvider controller={data}>
            <SelectionProvider>
                <SelectTask />
                <Profiler id="grid" onRender={() => commits.count++}>
                    <PropertyGrid />
                </Profiler>
            </SelectionProvider>
        </DataProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'выбрать' }));
    commits.count = 0;
    return { data, commits };
}

/**
 * Таблица свойств: подписка на выделенные объекты
 */
describe('PropertyGrid: addressed subscription', () => {
    /**
     * Проверяет, что правка невыделенного и не упомянутого объекта не перерисовывает таблицу
     */
    it('unrelatedChange_doesNotRerenderGrid', async () => {
        const { data, commits } = await renderGrid();

        await act(() => data.setProperty('q', 'name', 'Пётр 2'));

        expect(commits.count).toBe(0);
    });

    /**
     * Проверяет, что правка выделенного объекта видна в таблице
     */
    it('selectedObjectChange_isShown', async () => {
        const { data } = await renderGrid();

        await act(() => data.setProperty('t', 'name', 'Новое'));

        expect(screen.getByLabelText('Имя')).toHaveValue('Новое');
    });

    /**
     * Проверяет, что переименование цели ссылки обновляет её название в таблице
     */
    it('referenceTargetRename_updatesLabel', async () => {
        const { data } = await renderGrid();
        expect(screen.getByText('Иван')).toBeInTheDocument();

        await act(() => data.setProperty('p', 'name', 'Иван Петрович'));

        expect(screen.getByText('Иван Петрович')).toBeInTheDocument();
    });
});
