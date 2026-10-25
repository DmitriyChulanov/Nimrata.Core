import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';

import { MainMenu } from '../tabs/MainMenu';
import { TabsProvider } from '../tabs/TabsProvider';
import { createMenuRegistry, createTabRegistry } from '../tabs/registries';
import { createDataController } from './DataController';
import { DataProvider } from './DataProvider';
import { UndoControls } from './UndoControls';
import { createFakeApi } from './fakeApi';

const types = [{ id: 'Note', name: 'Заметка', module: 't', moduleVersion: 1 }];
const objects = [{ id: 'a', type: 'Note', parent: null, order: 1, properties: { title: 'A' } }];

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

it('пункты «Правка» отключены, пока нечего отменять и повторять', async () => {
    const user = userEvent.setup();
    await setup();
    await openEdit(user);
    expect(screen.getByRole('menuitem', { name: /Отменить/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /Повторить/ })).toBeDisabled();
});

it('«Отменить» и «Повторить» из меню работают и включаются по состоянию стека', async () => {
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

it('Ctrl+Z отменяет, Ctrl+Y и Ctrl+Shift+Z повторяют', async () => {
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

it('в поле ввода Ctrl+Z остаётся за браузером', async () => {
    const user = userEvent.setup();
    const { data } = await setup();
    await act(() => data.setProperty('a', 'title', 'X'));

    await user.click(screen.getByLabelText('Поле'));
    await user.keyboard('{Control>}z{/Control}');

    expect(data.getObject('a')?.properties.title).toBe('X');
});

it('при конфликте показывается сообщение, а данные не меняются', async () => {
    const user = userEvent.setup();
    const { data, api } = await setup();
    await act(() => data.setProperty('a', 'title', 'X'));
    api.rejectNext(409, 'Значение изменено в другом окне.');

    await user.keyboard('{Control>}z{/Control}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Значение изменено в другом окне.');
    expect(data.getObject('a')?.properties.title).toBe('X');
    expect(data.canUndo()).toBe(true);
});
