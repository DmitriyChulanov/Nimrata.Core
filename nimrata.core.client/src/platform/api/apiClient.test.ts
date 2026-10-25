import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './apiClient';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('ApiClient', () => {
    it('get_baseUrlApi_returnsParsedJson', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ name: 'Nimrata' }));
        const api = createApiClient({ fetch: fetchMock });

        const result = await api.get<{ name: string }>('/types');

        expect(result).toEqual({ name: 'Nimrata' });
        expect(fetchMock.mock.calls[0][0]).toBe('/api/types');
        expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    });

    it('post_body_isSentAsJsonWithContentTypeHeader', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));
        const api = createApiClient({ fetch: fetchMock });

        await api.post('/changesets', { items: [1, 2] });

        const init = fetchMock.mock.calls[0][1];
        expect(init.method).toBe('POST');
        expect(init.body).toBe(JSON.stringify({ items: [1, 2] }));
        expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    });

    it('request_getHeaders_addsHeadersSuchAsAccessToken', async () => {
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

    it('request_customBaseUrl_isRespected', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
        const api = createApiClient({ fetch: fetchMock, baseUrl: '/v2/' });

        await api.get('/x');

        expect(fetchMock.mock.calls[0][0]).toBe('/v2/x');
    });

    it('request_errorResponse_takesReasonFromDetailField', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                jsonResponse(
                    { title: 'Unprocessable Entity', detail: 'Операция 1: объект не найден.' },
                    422,
                ),
            );
        const api = createApiClient({ fetch: fetchMock });

        const error = await api.post('/changesets', {}).catch((e: unknown) => e);

        expect((error as ApiError).message).toBe('Операция 1: объект не найден.');
    });

    it('request_errorResponseWithErrorField_takesReasonFromIt', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'Старый формат' }, 400));
        const api = createApiClient({ fetch: fetchMock });

        const error = await api.get('/x').catch((e: unknown) => e);

        expect((error as ApiError).message).toBe('Старый формат');
    });

    it('request_errorResponse_throwsApiErrorWithStatusAndServerMessage', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ title: 'Нет доступа' }, 403));
        const api = createApiClient({ fetch: fetchMock });

        const error = await api.get('/secret').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(403);
        expect((error as ApiError).message).toBe('Нет доступа');
    });

    it('request_errorResponseWithoutJsonBody_usesStatusInMessage', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
        const api = createApiClient({ fetch: fetchMock });

        const error = await api.get('/x').catch((e: unknown) => e);

        expect((error as ApiError).status).toBe(500);
        expect((error as ApiError).message).toContain('500');
    });

    it('request_response204_returnsUndefined', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        const api = createApiClient({ fetch: fetchMock });

        await expect(api.delete('/objects/1')).resolves.toBeUndefined();
    });
});
