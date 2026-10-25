import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './apiClient';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('ApiClient: refresh on 401', () => {
    it('unauthorized_401_callsOnUnauthorizedOnceAndRetriesRequest', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockResolvedValueOnce(jsonResponse({ ok: true }));
        const onUnauthorized = vi.fn().mockResolvedValue(true);
        const api = createApiClient({ fetch: fetchMock, onUnauthorized });

        const result = await api.get('/types');

        expect(result).toEqual({ ok: true });
        expect(onUnauthorized).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('unauthorized_retry_takesHeadersAgainWithNewToken', async () => {
        let токен = 'old';
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockResolvedValueOnce(jsonResponse({}));
        const api = createApiClient({
            fetch: fetchMock,
            getHeaders: () => ({ Authorization: `Bearer ${токен}` }),
            onUnauthorized: async () => {
                токен = 'new';
                return true;
            },
        });

        await api.get('/x');

        expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Authorization')).toBe(
            'Bearer new',
        );
    });

    it('unauthorized_refreshFailed_throwsApiError401WithoutRetry', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
        const api = createApiClient({ fetch: fetchMock, onUnauthorized: async () => false });

        const error = await api.get('/x').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(401);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('unauthorized_401AfterRefresh_doesNotLoop', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
        const onUnauthorized = vi.fn().mockResolvedValue(true);
        const api = createApiClient({ fetch: fetchMock, onUnauthorized });

        const error = await api.get('/x').catch((e: unknown) => e);

        expect((error as ApiError).status).toBe(401);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });
});
