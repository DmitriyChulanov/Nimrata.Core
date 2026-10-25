/** Единый префикс всех маршрутов API платформы (совпадает с прокси в vite.config.ts). */
export const API_PREFIX = '/api';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
    /** Базовый адрес API. По умолчанию `/api`. */
    baseUrl?: string;
    /** Подмена `fetch` (для тестов). */
    fetch?: FetchFn;
    /** Дополнительные заголовки для каждого запроса (например, токен доступа). */
    getHeaders?: () => Record<string, string>;
}

export interface ApiClient {
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    put<T>(path: string, body?: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
}

export class ApiError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

async function readErrorMessage(response: Response): Promise<string> {
    const fallback = `Ошибка запроса: ${response.status}`;
    try {
        const body: unknown = await response.json();
        if (body && typeof body === 'object') {
            const { title, message } = body as { title?: unknown; message?: unknown };
            if (typeof title === 'string' && title) return title;
            if (typeof message === 'string' && message) return message;
        }
    } catch {
        // Тело не JSON — используем сообщение по умолчанию.
    }
    return fallback;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
    const baseUrl = (options.baseUrl ?? API_PREFIX).replace(/\/+$/, '');
    const doFetch: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));

    async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const headers = new Headers(options.getHeaders?.());
        const init: RequestInit = { method, headers, credentials: 'same-origin' };
        if (body !== undefined) {
            headers.set('Content-Type', 'application/json');
            init.body = JSON.stringify(body);
        }

        const response = await doFetch(`${baseUrl}/${path.replace(/^\/+/, '')}`, init);
        if (!response.ok) {
            throw new ApiError(response.status, await readErrorMessage(response));
        }
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
    }

    return {
        get: (path) => request('GET', path),
        post: (path, body) => request('POST', path, body),
        put: (path, body) => request('PUT', path, body),
        delete: (path) => request('DELETE', path),
    };
}
