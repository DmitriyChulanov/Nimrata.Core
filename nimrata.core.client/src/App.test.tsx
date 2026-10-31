import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { menuRegistry, tabRegistry } from '@platform';

import { App } from './App';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

/**
 * Проверяет, что без сессии показывается экран входа
 */
it('app_withoutSession_showsLoginScreen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    render(<App />);

    expect(await screen.findByLabelText('Электронная почта')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
});

/**
 * Проверяет, что после перезагрузки страницы сессия восстанавливается по refresh-cookie
 */
it('app_afterPageReload_restoresSessionViaRefresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accessToken: 'tok' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Nimrata' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/refresh');
});

/**
 * Проверяет, что вход по адресу и паролю открывает приложение
 */
it('app_loginWithEmailAndPassword_opensApplication', async () => {
    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 401 })) // refresh при загрузке
        .mockResolvedValueOnce(jsonResponse({ accessToken: 'tok' })); // login
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('Электронная почта'), 'a@b.test');
    await user.type(screen.getByLabelText('Пароль'), 'password1');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByRole('heading', { name: 'Nimrata' })).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/login');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
        email: 'a@b.test',
        password: 'password1',
    });
});

/**
 * Проверяет, что неверный пароль показывает сообщение и оставляет экран входа
 */
it('app_wrongPassword_showsMessageAndStaysOnLogin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('Электронная почта'), 'a@b.test');
    await user.type(screen.getByLabelText('Пароль'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный e-mail или пароль');
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
});

/**
 * Проверяет, что выход возвращает на экран входа
 */
it('app_logout_returnsToLoginScreen', async () => {
    const fetchMock = vi
        .fn()
        .mockImplementation((url: string) =>
            Promise.resolve(
                url === '/api/auth/logout'
                    ? new Response(null, { status: 204 })
                    : jsonResponse({ accessToken: 'tok' }),
            ),
        );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Выйти' }));

    await waitFor(() => expect(screen.getByLabelText('Пароль')).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/logout')).toBe(true);
});

/**
 * Проверяет, что после входа видны три панели, а выбранный объект показывается в свойствах
 */
it('app_afterLogin_showsThreePanelsAndSelectedObjectInProperties', async () => {
    const types = [
        {
            id: 'Note',
            name: 'Заметка',
            extension: 't',
            extensionVersion: 1,
            properties: [{ id: 'name', name: 'Название', kind: 'string' }],
        },
    ];
    const objects = [
        { id: 'n1', type: 'Note', parent: null, number: 0, properties: { name: 'Идея' } },
    ];
    vi.stubGlobal(
        'fetch',
        vi
            .fn()
            .mockImplementation((url: string) =>
                Promise.resolve(
                    url === '/api/snapshot'
                        ? jsonResponse({ seq: 0, types, objects })
                        : url === '/api/objects'
                          ? jsonResponse(objects)
                          : url === '/api/extensions'
                            ? jsonResponse([])
                            : jsonResponse({ accessToken: 'tok' }),
                ),
            ),
    );
    const user = userEvent.setup();
    render(<App />);

    const item = await screen.findByRole('treeitem', { name: 'Идея' });
    expect(screen.getByRole('region', { name: 'Дерево' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Вкладки' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Свойства' })).toBeInTheDocument();

    await user.click(item);

    expect(
        within(screen.getByRole('region', { name: 'Свойства' })).getByLabelText('Название'),
    ).toHaveValue('Идея');
});

/**
 * Проверяет, что вкладка и пункт меню платформы работают без расширений, а роль скрывает недоступные пункты
 */
it('app_platformTabAndMenuItem_workWithoutExtensionsAndRoleHidesItems', async () => {
    tabRegistry.register({
        id: 'app-test',
        title: 'Проверка',
        component: () => <p>Экран проверки</p>,
    });
    menuRegistry.register({
        path: ['Вид', 'Проверка'],
        run: (c) => c.openTab('app-test'),
    });
    menuRegistry.register({
        path: ['Вид', 'Только админ'],
        role: 'admin',
        run: () => {},
    });
    vi.stubGlobal(
        'fetch',
        vi
            .fn()
            .mockImplementation((url: string) =>
                Promise.resolve(
                    url === '/api/snapshot'
                        ? jsonResponse({ seq: 0, types: [], objects: [] })
                        : url === '/api/objects' || url === '/api/extensions'
                          ? jsonResponse([])
                          : url === '/api/auth/me'
                            ? jsonResponse({ id: 'u1', email: 'a@b.test', isAdmin: false })
                            : jsonResponse({ accessToken: 'tok' }),
                ),
            ),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('menuitem', { name: 'Вид' }));
    expect(screen.queryByRole('menuitem', { name: 'Только админ' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Проверка' }));

    expect(screen.getByText('Экран проверки')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Проверка/ })).toBeInTheDocument();
});

function stubSession(isAdmin: boolean) {
    vi.stubGlobal(
        'fetch',
        vi
            .fn()
            .mockImplementation((url: string) =>
                Promise.resolve(
                    url === '/api/snapshot'
                        ? jsonResponse({ seq: 0, types: [], objects: [] })
                        : url === '/api/admin/users' || url === '/api/extensions'
                          ? jsonResponse([])
                          : url === '/api/auth/me'
                            ? jsonResponse({ id: 'u1', email: 'a@b.test', isAdmin })
                            : jsonResponse({ accessToken: 'tok' }),
                ),
            ),
    );
}

/**
 * Проверяет, что администратор открывает вкладку пользователей из меню администрирования
 */
it('app_administrator_opensUsersTabFromAdministrationMenu', async () => {
    stubSession(true);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('menuitem', { name: 'Администрирование' }));
    await user.click(screen.getByRole('menuitem', { name: 'Пользователи' }));

    expect(screen.getByRole('tab', { name: /Пользователи/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Создать' })).toBeInTheDocument();
});

/**
 * Проверяет, что обычный пользователь не видит меню администрирования
 */
it('app_member_doesNotSeeAdministrationMenu', async () => {
    stubSession(false);
    render(<App />);

    await screen.findByRole('region', { name: 'Вкладки' });
    expect(screen.queryByRole('menuitem', { name: 'Администрирование' })).not.toBeInTheDocument();
});

/**
 * Проверяет, что ссылка из письма открывает форму нового пароля с токеном из адреса
 */
it('app_resetLinkFromEmail_opensNewPasswordFormWithTokenFromAddress', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/reset-password?token=abc');
    const user = userEvent.setup();
    try {
        render(<App />);

        await user.type(await screen.findByLabelText('Новый пароль'), 'new-password-1');
        await user.type(screen.getByLabelText('Повторите пароль'), 'new-password-1');
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
        await user.click(screen.getByRole('button', { name: 'Сменить пароль' }));
        await user.click(await screen.findByRole('button', { name: 'Перейти ко входу' }));

        expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
        expect(window.location.pathname).toBe('/');
        const call = fetchMock.mock.calls.find(([url]) => url === '/api/auth/reset-password');
        expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
            token: 'abc',
            password: 'new-password-1',
        });
    } finally {
        window.history.pushState({}, '', '/');
    }
});
