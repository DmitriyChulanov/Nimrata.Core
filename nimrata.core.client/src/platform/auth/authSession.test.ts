import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@platform/api/apiClient';

import { createAuthSession } from './authSession';

import type { FetchFn } from '@platform/api/apiClient';

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

/**
 * Сессия входа
 */
describe('AuthSession', () => {
    /**
     * Проверяет, что после входа токен хранится только в памяти и без хранилищ браузера
     */
    it('login_success_keepsAccessInMemoryAndAuthenticatesWithoutBrowserStorage', async () => {
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
        expect(session.getAccessToken()).toBe('tok-1');
        expect(JSON.stringify({ ...localStorage })).not.toContain('tok-1');
        expect(JSON.stringify({ ...sessionStorage })).not.toContain('tok-1');
    });

    /**
     * Проверяет, что неверный пароль бросает ошибку, а состояние остаётся анонимным
     */
    it('login_wrongPassword_throwsAndStateStaysAnonymous', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
        const session = setup(fetchMock);
        await session.restore();

        await expect(session.login('a@b.test', 'bad')).rejects.toThrow();

        expect(session.getState().status).toBe('anonymous');
        expect(session.getHeaders()).toEqual({});
        expect(session.getAccessToken()).toBeNull();
    });

    /**
     * Проверяет, что восстановление по refresh возвращает сессию после перезагрузки страницы
     */
    it('restore_viaRefresh_restoresSessionAfterPageReload', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accessToken: 'tok-2' }));
        const session = setup(fetchMock);
        expect(session.getState().status).toBe('loading');

        await session.restore();

        expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/refresh');
        expect(fetchMock.mock.calls[0][1].method).toBe('POST');
        expect(session.getState().status).toBe('authenticated');
        expect(session.getHeaders()).toEqual({ Authorization: 'Bearer tok-2' });
    });

    /**
     * Проверяет, что без действующего refresh состояние становится анонимным
     */
    it('restore_withoutValidRefresh_becomesAnonymous', async () => {
        const session = setup(vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

        await session.restore();

        expect(session.getState().status).toBe('anonymous');
    });

    /**
     * Проверяет, что параллельные обновления сливаются в один запрос
     */
    it('refresh_concurrentCalls_mergeIntoOneRefreshRequest', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accessToken: 'tok-3' }));
        const session = setup(fetchMock);

        const results = await Promise.all([session.refresh(), session.refresh()]);

        expect(results).toEqual([true, true]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что выход вызывает сервер и очищает токен, даже если сервер недоступен
     */
    it('logout_callsServerAndClearsTokenEvenIfServerUnavailable', async () => {
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

    /**
     * Проверяет, что смена состояния уведомляет подписчиков
     */
    it('subscribe_stateChange_notifiesSubscribers', async () => {
        const session = setup(vi.fn().mockResolvedValue(jsonResponse({ accessToken: 't' })));
        const listener = vi.fn();
        session.subscribe(listener);

        await session.login('a@b.test', 'password1');

        expect(listener).toHaveBeenCalled();
    });

    /**
     * Проверяет, что обновление без сети (вход мог истечь, проверить нельзя) даёт «офлайн», а не
     * «не вошли»: работа продолжается локально; токена при этом нет
     */
    it('refresh_networkFailure_becomesOfflineWithoutToken', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ accessToken: 'tok-1' }))
            .mockRejectedValue(new TypeError('Failed to fetch'));
        const session = setup(fetchMock);
        await session.login('a@b.test', 'password1');

        expect(await session.refresh()).toBe(false);

        expect(session.getState().status).toBe('offline');
        expect(session.getAccessToken()).toBeNull();
    });

    /**
     * Проверяет, что после возвращения сети успешное обновление снова даёт «вошли», а отказ
     * сервера (вход истёк) — «не вошли»
     */
    it('refresh_afterOffline_serverDecides', async () => {
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(jsonResponse({ accessToken: 'tok-2' }))
            .mockResolvedValueOnce(new Response(null, { status: 401 }));
        const session = setup(fetchMock);
        await session.restore();
        expect(session.getState().status).toBe('offline');

        expect(await session.refresh()).toBe(true);
        expect(session.getState().status).toBe('authenticated');

        expect(await session.refresh()).toBe(false);
        expect(session.getState().status).toBe('anonymous');
    });
});
