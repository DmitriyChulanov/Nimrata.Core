/**
 * Единый префикс всех маршрутов API платформы (совпадает с прокси в vite.config.ts)
 */
export const API_PREFIX = '/api';

/**
 * Функция отправки запроса, совместимая с `fetch`
 */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Параметры API-клиента
 */
export interface ApiClientOptions {
    /** Базовый адрес API. По умолчанию `/api` */
    baseUrl?: string;
    /** Подмена `fetch` (для тестов) */
    fetch?: FetchFn;
    /** Дополнительные заголовки для каждого запроса (например, токен доступа) */
    getHeaders?: () => Record<string, string>;
    /** Вызывается при ответе 401; если вернула true, запрос повторяется один раз */
    onUnauthorized?: () => Promise<boolean>;
}

/**
 * Клиент API платформы; ответ разбирается как JSON, отказ приходит как `ApiError`
 */
export interface ApiClient {
    /** Выполняет GET-запрос */
    get<T>(path: string): Promise<T>;
    /** Выполняет POST-запрос с необязательным телом */
    post<T>(path: string, body?: unknown): Promise<T>;
    /** Выполняет PUT-запрос с необязательным телом */
    put<T>(path: string, body?: unknown): Promise<T>;
    /** Выполняет DELETE-запрос */
    delete<T>(path: string): Promise<T>;
}

/**
 * Отказ сервера: код ответа и сообщение, пригодное для показа пользователю
 */
export class ApiError extends Error {
    /** HTTP-код ответа */
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

/**
 * Достаёт сообщение об ошибке из тела ответа (ProblemDetails или похожий JSON)
 *
 * @param response - ответ с неуспешным кодом
 * @returns текст причины или сообщение по умолчанию с кодом ответа
 */
async function readErrorMessage(response: Response): Promise<string> {
    const fallback = `Ошибка запроса: ${response.status}`;
    try {
        const body: unknown = await response.json();
        if (body && typeof body === 'object') {
            // ProblemDetails: понятное сообщение лежит в detail, title — лишь общий текст статуса
            for (const key of ['detail', 'message', 'error', 'title']) {
                const text = (body as Record<string, unknown>)[key];
                if (typeof text === 'string' && text) return text;
            }
        }
    } catch {
        // Тело не JSON — используем сообщение по умолчанию
    }
    return fallback;
}

/**
 * Создаёт API-клиент
 *
 * @param options - базовый адрес, подмена `fetch`, заголовки и повтор при 401
 * @returns клиент для запросов к API
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
    const baseUrl = (options.baseUrl ?? API_PREFIX).replace(/\/+$/, '');
    const doFetch: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));

    function send(method: string, path: string, body?: unknown): Promise<Response> {
        const headers = new Headers(options.getHeaders?.());
        const init: RequestInit = { method, headers, credentials: 'same-origin' };
        if (body !== undefined) {
            headers.set('Content-Type', 'application/json');
            init.body = JSON.stringify(body);
        }
        return doFetch(`${baseUrl}/${path.replace(/^\/+/, '')}`, init);
    }

    async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
        let response = await send(method, path, body);
        if (response.status === 401 && options.onUnauthorized && (await options.onUnauthorized())) {
            // единственная повторная попытка; заголовки собираются заново, уже с новым токеном
            response = await send(method, path, body);
        }
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
