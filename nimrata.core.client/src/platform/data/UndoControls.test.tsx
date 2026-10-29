import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';

import { MainMenu } from '@platform/tabs/MainMenu';
import { TabsProvider } from '@platform/tabs/TabsProvider';
import { createMenuRegistry, createTabRegistry } from '@platform/tabs/registries';

import { createDataController } from './DataController';
import { DataProvider } from './DataProvider';
import { UndoControls } from './UndoControls';
import { createFakeApi, whenSynced } from './fakeApi';

const types = [
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'title', name: 'Название', kind: 'string' }],
    },
];
const objects = [{ id: 'a', type: 'Note', parent: null, number: 1, properties: { title: 'A' } }];

async function setup() {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    const menu = createMenuRegistry();
    render(
        <TabsProvider registry={createTabRegistry()} userId="u1">
            <DataProvider controller={data}>
                <MainMenu registry={menu} role="member" />
                <UndoControls registry={menu} />
                <input aria-label="Поле" />
            </DataProvider>
        </TabsProvider>,
    );
    return { api, data };
}

async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('menuitem', { name: 'Правка' }));
}

/**
 * Проверяет, что пункты правки отключены, пока нечего отменять и повторять
 */
it('undoControls_editItems_disabledWhileNothingToUndoOrRedo', async () => {
    const user = userEvent.setup();
    await setup();
    await openEdit(user);
    expect(screen.getByRole('menuitem', { name: /Отменить/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /Повторить/ })).toBeDisabled();
});

/**
 * Проверяет, что отмена и повтор из меню работают и включаются по состоянию стека
 */
it('undoControls_undoAndRedoFromMenu_workAndEnableByStackState', async () => {
    const user = userEvent.setup();
    const { data } = await setup();
    await act(() => data.setProperty('a', 'title', 'X'));

    await openEdit(user);
    expect(screen.getByRole('menuitem', { name: /Отменить/ })).toBeEnabled();
    await user.click(screen.getByRole('menuitem', { name: /Отменить/ }));
    expect(data.getObject('a')?.properties.title).toBe('A');

    await openEdit(user);
    expect(screen.getByRole('menuitem', { name: /Повторить/ })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: /Отменить/ })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: /Повторить/ }));
    expect(data.getObject('a')?.properties.title).toBe('X');
});

/**
 * Проверяет, что `Ctrl+Z` отменяет, а `Ctrl+Y` и `Ctrl+Shift+Z` повторяют
 */
it('undoControls_ctrlZUndoes_ctrlYAndCtrlShiftZRedo', async () => {
    const user = userEvent.setup();
    const { data } = await setup();
    await act(() => data.setProperty('a', 'title', 'X'));

    await user.keyboard('{Control>}z{/Control}');
    expect(data.getObject('a')?.properties.title).toBe('A');

    await user.keyboard('{Control>}y{/Control}');
    expect(data.getObject('a')?.properties.title).toBe('X');

    await user.keyboard('{Control>}z{/Control}');
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(data.getObject('a')?.properties.title).toBe('X');
});

/**
 * Проверяет, что в поле ввода `Ctrl+Z` остаётся за браузером
 */
it('undoControls_inInputField_ctrlZStaysWithBrowser', async () => {
    const user = userEvent.setup();
    const { data } = await setup();
    await act(() => data.setProperty('a', 'title', 'X'));

    await user.click(screen.getByLabelText('Поле'));
    await user.keyboard('{Control>}z{/Control}');

    expect(data.getObject('a')?.properties.title).toBe('X');
});

/**
 * Проверяет, что конфликт показывает сообщение и не меняет данные
 */
it('undoControls_conflict_showsMessageAndDataUnchanged', async () => {
    const user = userEvent.setup();
    const { data, api } = await setup();
    await act(() => data.setProperty('a', 'title', 'X'));
    await act(() => whenSynced(data));
    api.rejectNext(409, 'Значение изменено в другом окне.');

    await user.keyboard('{Control>}z{/Control}');
    await act(() => whenSynced(data));

    expect(await screen.findByRole('alert')).toHaveTextContent('Значение изменено в другом окне.');
    expect(data.getObject('a')?.properties.title).toBe('X');
    expect(data.canUndo()).toBe(true);
});
