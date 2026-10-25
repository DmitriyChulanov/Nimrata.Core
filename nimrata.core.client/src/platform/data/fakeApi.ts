import { ApiError } from '../api/apiClient';
import type { ApiClient } from '../api/apiClient';

/** Поддельный API-клиент в памяти для тестов `DataController`: отдаёт типы и объекты, записывает наборы изменений. */
export interface FakeApi extends ApiClient {
    types: unknown[];
    objects: unknown[];
    /** Все принятые наборы изменений (тела запросов). */
    changesets: { operations: Record<string, unknown>[] }[];
    /** Следующий набор будет отклонён этой ошибкой. */
    rejectNext(status: number, message: string): void;
}

export function createFakeApi(types: unknown[] = [], objects: unknown[] = []): FakeApi {
    let rejection: ApiError | null = null;
    const api: FakeApi = {
        types,
        objects,
        changesets: [],
        rejectNext(status, message) {
            rejection = new ApiError(status, message);
        },
        get: (path) => {
            if (path === 'types') return Promise.resolve(api.types as never);
            if (path === 'objects') return Promise.resolve(api.objects as never);
            return Promise.reject(new ApiError(404, `нет маршрута ${path}`));
        },
        post: (path, body) => {
            if (path !== 'changesets') return Promise.reject(new ApiError(404, `нет маршрута ${path}`));
            if (rejection) {
                const error = rejection;
                rejection = null;
                return Promise.reject(error);
            }
            api.changesets.push(body as never);
            return Promise.resolve({ id: 'journal-1' } as never);
        },
        put: () => Promise.reject(new Error('не используется')),
        delete: () => Promise.reject(new Error('не используется')),
    };
    return api;
}
