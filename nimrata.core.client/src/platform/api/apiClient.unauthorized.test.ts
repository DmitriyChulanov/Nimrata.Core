import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './apiClient';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('ApiClient: обновление при 401', () => {
    it('при 401 один раз вызывает onUnauthorized и повторяет запрос', async () => {
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

    it('повторный запрос берёт заголовки заново (уже с новым токеном)', async () => {
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

    it('если обновить не удалось, бросает ApiError 401 без повтора', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
        const api = createApiClient({ fetch: fetchMock, onUnauthorized: async () => false });

        const error = await api.get('/x').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(401);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('если и после обновления 401, не зацикливается', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
        const onUnauthorized = vi.fn().mockResolvedValue(true);
        const api = createApiClient({ fetch: fetchMock, onUnauthorized });

        const error = await api.get('/x').catch((e: unknown) => e);

        expect((error as ApiError).status).toBe(401);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });
});
