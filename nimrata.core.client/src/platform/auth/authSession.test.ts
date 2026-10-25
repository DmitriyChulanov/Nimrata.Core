import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../api/apiClient';
import type { FetchFn } from '../api/apiClient';
import { createAuthSession } from './authSession';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function setup(fetchMock: ReturnType<typeof vi.fn>) {
    return createAuthSession({ api: createApiClient({ fetch: fetchMock as FetchFn }) });
}

afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

describe('AuthSession', () => {
    it('вход сохраняет access в памяти и переводит в authenticated; в хранилища браузера токен не попадает', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accessToken: 'tok-1' }));
        const session = setup(fetchMock);

        await session.login('a@b.test', 'password1');

        expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/login');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            email: 'a@b.test',
            password: 'password1',
        });
        expect(session.getState().status).toBe('authenticated');
        expect(session.getHeaders()).toEqual({ Authorization: 'Bearer tok-1' });
        expect(JSON.stringify({ ...localStorage })).not.toContain('tok-1');
        expect(JSON.stringify({ ...sessionStorage })).not.toContain('tok-1');
    });

    it('неверный пароль: login бросает ошибку и состояние остаётся anonymous', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
        const session = setup(fetchMock);
        await session.restore();

        await expect(session.login('a@b.test', 'bad')).rejects.toThrow();

        expect(session.getState().status).toBe('anonymous');
        expect(session.getHeaders()).toEqual({});
    });

    it('restore восстанавливает сессию через refresh (после обновления страницы)', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accessToken: 'tok-2' }));
        const session = setup(fetchMock);
        expect(session.getState().status).toBe('loading');

        await session.restore();

        expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/refresh');
        expect(fetchMock.mock.calls[0][1].method).toBe('POST');
        expect(session.getState().status).toBe('authenticated');
        expect(session.getHeaders()).toEqual({ Authorization: 'Bearer tok-2' });
    });

    it('restore без действующего refresh переводит в anonymous', async () => {
        const session = setup(vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

        await session.restore();

        expect(session.getState().status).toBe('anonymous');
    });

    it('одновременные обновления сливаются в один запрос refresh', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accessToken: 'tok-3' }));
        const session = setup(fetchMock);

        const results = await Promise.all([session.refresh(), session.refresh()]);

        expect(results).toEqual([true, true]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('выход вызывает сервер и сбрасывает токен, даже если сервер недоступен', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ accessToken: 'tok-4' }))
            .mockRejectedValueOnce(new Error('network'));
        const session = setup(fetchMock);
        await session.login('a@b.test', 'password1');

        await session.logout();

        expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/logout');
        expect(session.getState().status).toBe('anonymous');
        expect(session.getHeaders()).toEqual({});
    });

    it('уведомляет подписчиков об изменении состояния', async () => {
        const session = setup(vi.fn().mockResolvedValue(jsonResponse({ accessToken: 't' })));
        const listener = vi.fn();
        session.subscribe(listener);

        await session.login('a@b.test', 'password1');

        expect(listener).toHaveBeenCalled();
    });
});
