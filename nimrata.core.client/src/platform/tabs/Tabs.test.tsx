import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { MainMenu } from './MainMenu';
import { TabContainer } from './TabContainer';
import { TabsProvider } from './TabsProvider';
import { createMenuRegistry, createTabRegistry } from './registries';
import type { UserRole } from './registries';

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

function setup(role: UserRole = 'member', userId = 'u1') {
    const tabs = createTabRegistry();
    tabs.register({ id: 'journal', title: 'Журнал', component: () => <p>Содержимое журнала</p> });
    tabs.register({
        id: 'note',
        title: 'Заметка',
        multiple: true,
        component: () => <p>Содержимое заметки</p>,
    });
    tabs.register({ id: 'users', title: 'Пользователи', component: () => <p>Список</p> });
    const menu = createMenuRegistry();
    menu.register({ path: ['Вид', 'Журнал'], run: (c) => c.openTab('journal') });
    menu.register({ path: ['Вид', 'Заметка'], run: (c) => c.openTab('note') });
    menu.register({
        path: ['Администрирование', 'Пользователи'],
        role: 'admin',
        run: (c) => c.openTab('users'),
    });
    const ui = (
        <TabsProvider registry={tabs} userId={userId}>
            <MainMenu registry={menu} role={role} />
            <TabContainer />
        </TabsProvider>
    );
    return { ui, ...render(ui) };
}

async function choose(user: ReturnType<typeof userEvent.setup>, group: string, item: string) {
    await user.click(screen.getByRole('menuitem', { name: group }));
    await user.click(screen.getByRole('menuitem', { name: item }));
}

it('меню строится из реестра и открывает вкладку выбранного пункта', async () => {
    const user = userEvent.setup();
    setup();

    await choose(user, 'Вид', 'Журнал');

    expect(screen.getByRole('tab', { name: /Журнал/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Содержимое журнала')).toBeInTheDocument();
});

it('пункты, недоступные роли, не показываются', async () => {
    const user = userEvent.setup();
    setup('member');

    expect(screen.queryByRole('menuitem', { name: 'Администрирование' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Вид' }));
    expect(screen.queryByRole('menuitem', { name: 'Пользователи' })).not.toBeInTheDocument();
});

it('администратор видит административный пункт', async () => {
    const user = userEvent.setup();
    setup('admin');

    await choose(user, 'Администрирование', 'Пользователи');

    expect(screen.getByText('Список')).toBeInTheDocument();
});

it('вкладки переключаются и закрываются', async () => {
    const user = userEvent.setup();
    setup();
    await choose(user, 'Вид', 'Журнал');
    await choose(user, 'Вид', 'Заметка');
    expect(screen.getByText('Содержимое заметки')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Журнал/ }));
    expect(screen.getByText('Содержимое журнала')).toBeInTheDocument();
    expect(screen.queryByText('Содержимое заметки')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Закрыть вкладку Журнал' }));
    expect(screen.queryByRole('tab', { name: /Журнал/ })).not.toBeInTheDocument();
    expect(screen.getByText('Содержимое заметки')).toBeInTheDocument();
});

it('повторное открытие вида с одной копией переключает на существующую вкладку', async () => {
    const user = userEvent.setup();
    setup();
    await choose(user, 'Вид', 'Журнал');
    await choose(user, 'Вид', 'Заметка');

    await choose(user, 'Вид', 'Журнал');

    expect(screen.getAllByRole('tab', { name: /Журнал/ })).toHaveLength(1);
    expect(screen.getByRole('tab', { name: /Журнал/ })).toHaveAttribute('aria-selected', 'true');
});

it('вид с несколькими копиями открывается заново каждый раз', async () => {
    const user = userEvent.setup();
    setup();

    await choose(user, 'Вид', 'Заметка');
    await choose(user, 'Вид', 'Заметка');

    expect(screen.getAllByRole('tab', { name: /Заметка/ })).toHaveLength(2);
});

it('раскладка восстанавливается после перезагрузки для того же пользователя', async () => {
    const user = userEvent.setup();
    const first = setup();
    await choose(user, 'Вид', 'Журнал');
    await choose(user, 'Вид', 'Заметка');
    await user.click(screen.getByRole('tab', { name: /Журнал/ }));
    first.unmount();

    setup();

    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /Журнал/ })).toHaveAttribute('aria-selected', 'true');
});

it('у другого пользователя раскладка пустая', async () => {
    const user = userEvent.setup();
    const first = setup('member', 'u1');
    await choose(user, 'Вид', 'Журнал');
    first.unmount();

    setup('member', 'u2');

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});

it('недоступное хранилище не ломает работу вкладок', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('закрыто');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('закрыто');
    });
    const user = userEvent.setup();
    setup();

    await choose(user, 'Вид', 'Журнал');

    expect(screen.getByText('Содержимое журнала')).toBeInTheDocument();
});

it('вкладки неизвестного вида из сохранённой раскладки пропускаются', () => {
    localStorage.setItem(
        'nimrata.layout.u1',
        JSON.stringify({
            tabs: [{ id: 'x#1', kind: 'removed' }],
            activeId: 'x#1',
            widths: { left: 280, right: 320 },
        }),
    );

    setup();

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});
