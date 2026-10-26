import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { DataProvider } from '@platform/data/DataProvider';
import { createFakeApi } from '@platform/data/fakeApi';
import { SelectionProvider } from '@platform/selection/SelectionProvider';
import { useSelection } from '@platform/selection/useSelection';
import { Tree } from '@platform/tree/Tree';

import { PropertyGrid } from './PropertyGrid';

const types = [
    {
        id: 'Folder',
        name: 'Папка',
        module: 't',
        moduleVersion: 1,
        allowedChildren: ['Person', 'Folder', 'Task'],
        properties: [{ id: 'name', name: 'Название', kind: 'string' }],
    },
    {
        id: 'Person',
        name: 'Человек',
        module: 't',
        moduleVersion: 1,
        properties: [{ id: 'name', name: 'Имя', kind: 'string' }],
    },
    {
        id: 'Task',
        name: 'Задача',
        module: 't',
        moduleVersion: 1,
        properties: [
            { id: 'name', name: 'Название', kind: 'string' },
            { id: 'owner', name: 'Владелец', kind: 'reference', targetTypes: ['Person'] },
            { id: 'any', name: 'Связь', kind: 'reference' },
        ],
    },
    { id: 'Secret', name: 'Механизм', module: 't', moduleVersion: 1, hiddenInTree: true },
];

function obj(
    id: string,
    type: string,
    parent: string | null,
    order: number,
    properties: Record<string, unknown> = {},
) {
    return { id, type, parent, order, properties };
}

const objects = [
    obj('f', 'Folder', null, 0, { name: 'Люди' }),
    obj('p1', 'Person', 'f', 0, { name: 'Иван' }),
    obj('p2', 'Person', 'f', 1, { name: 'Пётр' }),
    obj('deep', 'Folder', 'f', 2, { name: 'Вложенная' }),
    obj('p3', 'Person', 'deep', 0, { name: 'Глубокий' }),
    obj('s', 'Secret', null, 5),
    obj('t', 'Task', null, 1, { name: 'Задача А', owner: 'p1' }),
    obj('lost', 'Task', null, 2, { name: 'Задача Б', owner: 'gone' }),
];

function SelectionProbe() {
    return <output aria-label="выделено">{useSelection().selectedId ?? ''}</output>;
}

function nameOf(id: string) {
    return String(objects.find((o) => o.id === id)?.properties.name);
}

async function setup(selected = 't') {
    const api = createFakeApi(types, objects);
    const controller = createDataController({ api });
    await controller.load();
    render(
        <DataProvider controller={controller}>
            <SelectionProvider>
                <Tree />
                <PropertyGrid />
                <SelectionProbe />
            </SelectionProvider>
        </DataProvider>,
    );
    await userEvent.click(screen.getByRole('treeitem', { name: nameOf(selected) }));
    return { api, controller };
}

const row = (label: string) => screen.getByText(label).closest('.property-grid-row') as HTMLElement;

/**
 * Раскрывает в диалоге папку «Люди» и вложенную папку
 */
async function expandDialog(dialog: HTMLElement) {
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Развернуть' })[0]);
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Развернуть' })[0]);
}

/**
 * Ссылочное свойство: значение
 */
describe('Reference property: value', () => {
    /**
     * Проверяет, что значение показывается именем объекта
     */
    it('referenceEditor_value_showsObjectName', async () => {
        await setup();

        expect(within(row('Владелец')).getByText('Иван')).toBeInTheDocument();
    });

    /**
     * Проверяет, что ссылка на удалённый объект показывается как недоступная и без перехода
     */
    it('referenceEditor_referenceToDeletedObject_shownAsUnavailableWithoutNavigation', async () => {
        await setup('lost');

        const owner = row('Владелец');
        expect(within(owner).getByText('Недоступный объект')).toBeInTheDocument();
        expect(within(owner).getByRole('button', { name: 'Перейти: Владелец' })).toBeDisabled();
    });
});

/**
 * Ссылочное свойство: выбор в диалоге
 */
describe('Reference property: selection in dialog', () => {
    /**
     * Проверяет, что выбор применяется набором изменений
     */
    it('referenceEditor_choice_isAppliedByChangeset', async () => {
        const { api } = await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Выбрать: Владелец' }));
        const dialog = screen.getByRole('dialog', { name: 'Выбор объекта: Владелец' });
        await userEvent.click(within(dialog).getByRole('button', { name: 'Развернуть' }));
        await userEvent.click(within(dialog).getByRole('treeitem', { name: 'Пётр' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выбрать' }));

        expect(api.changesets).toHaveLength(1);
        expect(api.changesets[0].operations[0]).toMatchObject({
            op: 'update',
            id: 't',
            changes: { owner: { new: 'p2' } },
        });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(within(row('Владелец')).getByText('Пётр')).toBeInTheDocument();
    });

    /**
     * Проверяет, что диалог раскрывает папки и скрывает скрытые типы
     */
    it('referenceEditor_dialog_expandsFoldersAndHidesHiddenTypes', async () => {
        const { api } = await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Выбрать: Связь' }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByRole('treeitem', { name: 'Механизм' })).toBeNull();
        expect(within(dialog).queryByRole('treeitem', { name: 'Глубокий' })).toBeNull();
        await expandDialog(dialog);
        await userEvent.click(within(dialog).getByRole('treeitem', { name: 'Глубокий' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выбрать' }));

        expect(api.changesets[0].operations[0]).toMatchObject({ changes: { any: { new: 'p3' } } });
    });

    /**
     * Проверяет, что при `targetTypes` объекты других типов выбрать нельзя
     */
    it('referenceEditor_targetTypes_otherTypesCannotBeChosen', async () => {
        const { api } = await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Выбрать: Владелец' }));
        const dialog = screen.getByRole('dialog');
        await userEvent.click(within(dialog).getByRole('treeitem', { name: 'Люди' }));

        expect(within(dialog).getByRole('treeitem', { name: 'Люди' })).toHaveAttribute(
            'aria-disabled',
            'true',
        );
        expect(within(dialog).getByRole('button', { name: 'Выбрать' })).toBeDisabled();
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что без `targetTypes` доступен любой объект
     */
    it('referenceEditor_withoutTargetTypes_anyObjectIsAvailable', async () => {
        const { api } = await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Выбрать: Связь' }));
        const dialog = screen.getByRole('dialog');
        await userEvent.click(within(dialog).getByRole('treeitem', { name: 'Люди' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выбрать' }));

        expect(api.changesets[0].operations[0]).toMatchObject({ changes: { any: { new: 'f' } } });
    });

    /**
     * Проверяет, что отмена закрывает диалог без изменений
     */
    it('referenceEditor_cancel_closesDialogWithoutChanges', async () => {
        const { api } = await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Выбрать: Владелец' }));
        await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что очистка отправляет `null`
     */
    it('referenceEditor_clear_sendsNull', async () => {
        const { api } = await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Очистить: Владелец' }));

        expect(api.changesets[0].operations[0]).toMatchObject({
            changes: { owner: { new: null, old: 'p1' } },
        });
    });
});

/**
 * Ссылочное свойство: переход
 */
describe('Reference property: navigation', () => {
    /**
     * Проверяет, что переход выделяет объект в дереве и раскрывает его родителей
     */
    it('referenceEditor_navigate_selectsObjectInTreeAndExpandsParents', async () => {
        await setup();
        await userEvent.click(screen.getByRole('button', { name: 'Выбрать: Связь' }));
        const dialog = screen.getByRole('dialog');
        await expandDialog(dialog);
        await userEvent.click(within(dialog).getByRole('treeitem', { name: 'Глубокий' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выбрать' }));
        // Основное дерево свёрнуто: цели в нём не видно
        expect(screen.queryByRole('treeitem', { name: 'Глубокий' })).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'Перейти: Связь' }));

        expect(screen.getByLabelText('выделено')).toHaveTextContent('p3');
        expect(screen.getByRole('treeitem', { name: 'Глубокий' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });
});
