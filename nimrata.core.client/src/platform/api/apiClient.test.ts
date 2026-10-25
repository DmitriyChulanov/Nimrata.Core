import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './apiClient';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('ApiClient', () => {
    it('GET обращается к базовому адресу /api и возвращает разобранный JSON', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ name: 'Nimrata' }));
        const api = createApiClient({ fetch: fetchMock });

        const result = await api.get<{ name: string }>('/types');

        expect(result).toEqual({ name: 'Nimrata' });
        expect(fetchMock.mock.calls[0][0]).toBe('/api/types');
        expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    });

    it('POST отправляет тело как JSON с заголовком Content-Type', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));
        const api = createApiClient({ fetch: fetchMock });

        await api.post('/changesets', { items: [1, 2] });

        const init = fetchMock.mock.calls[0][1];
        expect(init.method).toBe('POST');
        expect(init.body).toBe(JSON.stringify({ items: [1, 2] }));
        expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    });

    it('добавляет заголовки, которые выдаёт getHeaders (например, токен доступа)', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
        const api = createApiClient({
            fetch: fetchMock,
            getHeaders: () => ({ Authorization: 'Bearer abc' }),
        });

        await api.get('/me');

        expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe(
            'Bearer abc',
        );
    });

    it('учитывает пользовательский базовый адрес', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
        const api = createApiClient({ fetch: fetchMock, baseUrl: '/v2/' });

        await api.get('/x');

        expect(fetchMock.mock.calls[0][0]).toBe('/v2/x');
    });

    it('берёт причину отказа из поля error (так отвечают наборы изменений)', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(jsonResponse({ error: 'Операция 1: объект не найден.' }, 422));
        const api = createApiClient({ fetch: fetchMock });

        const error = await api.post('/changesets', {}).catch((e: unknown) => e);

        expect((error as ApiError).message).toBe('Операция 1: объект не найден.');
    });

    it('для ответа с ошибкой бросает ApiError со статусом и сообщением сервера', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ title: 'Нет доступа' }, 403));
        const api = createApiClient({ fetch: fetchMock });

        const error = await api.get('/secret').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(403);
        expect((error as ApiError).message).toBe('Нет доступа');
    });

    it('для ответа с ошибкой без JSON-тела использует статус в сообщении', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
        const api = createApiClient({ fetch: fetchMock });

        const error = await api.get('/x').catch((e: unknown) => e);

        expect((error as ApiError).status).toBe(500);
        expect((error as ApiError).message).toContain('500');
    });

    it('для ответа 204 без тела возвращает undefined', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        const api = createApiClient({ fetch: fetchMock });

        await expect(api.delete('/objects/1')).resolves.toBeUndefined();
    });
});
