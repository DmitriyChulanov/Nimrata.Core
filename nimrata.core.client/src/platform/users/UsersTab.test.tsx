import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { AuthProvider } from '@platform/auth/AuthProvider';

import { UsersTab } from './UsersTab';

interface User {
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'member';
    isActive: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const admin: User = {
    id: 'a1',
    email: 'admin@x.test',
    name: 'Админ',
    role: 'admin',
    isActive: true,
};
const ivan: User = { id: 'u1', email: 'ivan@x.test', name: 'Иван', role: 'member', isActive: true };
const olga: User = {
    id: 'u2',
    email: 'olga@x.test',
    name: 'Ольга',
    role: 'member',
    isActive: false,
};

/** Сервер в памяти: список пользователей и запись вызовов администрирования */
function stubServer(
    initial: User[] = [admin, ivan, olga],
    reject?: { status: number; error: string },
) {
    const users = initial.map((u) => ({ ...u }));
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (!url.startsWith('/api/admin/users'))
            return Promise.resolve(jsonResponse({ accessToken: 't' }));
        const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
        calls.push({ method, url, body });
        if (method === 'GET') return Promise.resolve(jsonResponse(users));
        if (reject)
            return Promise.resolve(
                jsonResponse({ title: 'Conflict', detail: reject.error }, reject.status),
            );
        if (method === 'POST' && url === '/api/admin/users') {
            const b = body as { email: string; name: string; role: 'admin' | 'member' };
            users.push({ id: 'new', email: b.email, name: b.name, role: b.role, isActive: true });
            return Promise.resolve(jsonResponse(users.at(-1), 201));
        }
        const id = url.split('/')[4];
        const target = users.find((u) => u.id === id)!;
        if (url.endsWith('/role')) target.role = (body as { role: 'admin' | 'member' }).role;
        if (url.endsWith('/disable')) target.isActive = false;
        if (url.endsWith('/enable')) target.isActive = true;
        return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return { calls };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

function renderTab() {
    return render(
        <AuthProvider>
            <UsersTab />
        </AuthProvider>,
    );
}

it('usersTab_list_showsUsersWithRoleAndState', async () => {
    stubServer();
    renderTab();

    const row = await screen.findByRole('row', { name: /ivan@x\.test/ });
    expect(within(row).getByText('Иван')).toBeInTheDocument();
    expect(within(row).getByLabelText('Роль ivan@x.test')).toHaveValue('member');
    expect(within(row).getByText('Активен')).toBeInTheDocument();
    const disabledRow = screen.getByRole('row', { name: /olga@x\.test/ });
    expect(within(disabledRow).getByText('Отключён')).toBeInTheDocument();
});

it('usersTab_create_addsUserWithPasswordAndRoleAndRefreshesList', async () => {
    const { calls } = stubServer();
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('row', { name: /ivan@x\.test/ });

    await user.type(screen.getByLabelText('Электронная почта'), 'new@x.test');
    await user.type(screen.getByLabelText('Имя'), 'Новый');
    await user.type(screen.getByLabelText('Пароль'), 'password-1234');
    await user.selectOptions(screen.getByLabelText('Роль'), 'admin');
    await user.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByRole('row', { name: /new@x\.test/ })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        email: 'new@x.test',
        name: 'Новый',
        password: 'password-1234',
        role: 'admin',
    });
    expect(screen.getByLabelText('Пароль')).toHaveValue('');
});

it('usersTab_changeRole_bySelectingInList', async () => {
    const { calls } = stubServer();
    const user = userEvent.setup();
    renderTab();

    await user.selectOptions(await screen.findByLabelText('Роль ivan@x.test'), 'admin');

    await waitFor(() =>
        expect(calls).toContainEqual({
            method: 'PUT',
            url: '/api/admin/users/u1/role',
            body: { role: 'admin' },
        }),
    );
    expect(await screen.findByLabelText('Роль ivan@x.test')).toHaveValue('admin');
});

it('usersTab_disableAndEnable_user', async () => {
    const { calls } = stubServer();
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Отключить ivan@x.test' }));
    expect(await screen.findByRole('button', { name: 'Включить ivan@x.test' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Включить olga@x.test' }));
    expect(
        await screen.findByRole('button', { name: 'Отключить olga@x.test' }),
    ).toBeInTheDocument();

    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
        '/api/admin/users/u1/disable',
        '/api/admin/users/u2/enable',
    ]);
});

it('usersTab_serverRefusal_lastAdministratorIsShownToUser', async () => {
    const reason = 'Нельзя отключить или понизить последнего действующего администратора.';
    stubServer([admin], { status: 409, error: reason });
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Отключить admin@x.test' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(reason);
    expect(screen.getByLabelText('Роль admin@x.test')).toHaveValue('admin');
});

it('usersTab_sendPasswordResetButton_sendsEmailToSelectedUser', async () => {
    const { calls } = stubServer();
    const user = userEvent.setup();
    renderTab();

    await user.click(
        await screen.findByRole('button', { name: 'Отправить ссылку на смену пароля ivan@x.test' }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(/ivan@x\.test/);
    expect(calls).toContainEqual({
        method: 'POST',
        url: '/api/admin/users/u1/password-reset',
        body: undefined,
    });
});
