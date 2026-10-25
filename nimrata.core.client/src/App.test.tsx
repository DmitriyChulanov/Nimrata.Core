import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import App from './App';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

it('без действующей сессии показывает экран входа', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    render(<App />);

    expect(await screen.findByLabelText('Электронная почта')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
});

it('после обновления страницы сессия восстанавливается через refresh без ввода пароля', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accessToken: 'tok' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Nimrata' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/refresh');
});

it('вход по e-mail и паролю открывает приложение', async () => {
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

it('неверный пароль показывает сообщение и остаётся на экране входа', async () => {
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

it('выход возвращает на экран входа', async () => {
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
