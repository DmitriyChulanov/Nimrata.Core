import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { LoginScreen } from './LoginScreen';
import { ResetPasswordScreen } from './ResetPasswordScreen';

function jsonResponse(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

/**
 * Проверяет, что на экране входа есть ссылка «Забыли пароль?», открывающая форму запроса
 */
it('loginScreen_hasForgotPasswordLink_thatOpensRequestForm', async () => {
    const user = userEvent.setup();
    render(<LoginScreen onLogin={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Забыли пароль?' }));

    expect(screen.getByRole('heading', { name: 'Восстановление пароля' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
});

/**
 * Проверяет, что запрос отправляет адрес и показывает одинаковое подтверждение
 */
it('forgotPassword_request_sendsEmailAndShowsSameConfirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<LoginScreen onLogin={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Забыли пароль?' }));

    await user.type(screen.getByLabelText('Электронная почта'), 'a@b.test');
    await user.click(screen.getByRole('button', { name: 'Отправить ссылку' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
        /если такой адрес зарегистрирован/i,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/forgot-password');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.test' });
});

/**
 * Проверяет, что из формы можно вернуться ко входу
 */
it('forgotPassword_form_canReturnToLogin', async () => {
    const user = userEvent.setup();
    render(<LoginScreen onLogin={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Забыли пароль?' }));

    await user.click(screen.getByRole('button', { name: 'Вернуться ко входу' }));

    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
});

/**
 * Проверяет, что новый пароль отправляется с токеном, а успех сообщается
 */
it('resetPassword_newPassword_sendsTokenAndPasswordAndReportsSuccess', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<ResetPasswordScreen token="abc" onDone={onDone} />);

    await user.type(screen.getByLabelText('Новый пароль'), 'new-password-1');
    await user.type(screen.getByLabelText('Повторите пароль'), 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Сменить пароль' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/пароль изменён/i));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/reset-password');
    expect(JSON.parse(String(init.body))).toEqual({ token: 'abc', password: 'new-password-1' });
    await user.click(screen.getByRole('button', { name: 'Перейти ко входу' }));
    expect(onDone).toHaveBeenCalled();
});

/**
 * Проверяет, что несовпадающие пароли не отправляются на сервер
 */
it('resetPassword_mismatchedPasswords_areNotSentToServer', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<ResetPasswordScreen token="abc" onDone={vi.fn()} />);

    await user.type(screen.getByLabelText('Новый пароль'), 'new-password-1');
    await user.type(screen.getByLabelText('Повторите пароль'), 'other-password-1');
    await user.click(screen.getByRole('button', { name: 'Сменить пароль' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/не совпадают/i);
    expect(fetchMock).not.toHaveBeenCalled();
});

/**
 * Проверяет, что недействительная ссылка показывает причину от сервера
 */
it('resetPassword_invalidLink_showsServerReason', async () => {
    vi.stubGlobal(
        'fetch',
        vi
            .fn()
            .mockResolvedValue(
                jsonResponse(
                    { title: 'Bad Request', detail: 'Ссылка недействительна или устарела.' },
                    400,
                ),
            ),
    );
    const user = userEvent.setup();
    render(<ResetPasswordScreen token="old" onDone={vi.fn()} />);

    await user.type(screen.getByLabelText('Новый пароль'), 'new-password-1');
    await user.type(screen.getByLabelText('Повторите пароль'), 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Сменить пароль' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
        'Ссылка недействительна или устарела.',
    );
});
