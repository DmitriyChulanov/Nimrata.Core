import type { ApiClient } from '@platform/api/apiClient';

/**
 * Состояние входа: идёт восстановление, не вошли, вошли
 */
export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

/**
 * Снимок состояния входа
 */
export interface AuthState {
    /** Текущее состояние входа */
    status: AuthStatus;
}

/**
 * Сессия входа: состояние, токен доступа и операции входа и выхода
 */
export interface AuthSession {
    /** Текущий снимок состояния */
    getState(): AuthState;
    /** Подписка на изменения состояния; возвращает функцию отписки */
    subscribe(listener: () => void): () => void;
    /** Заголовки с access-токеном для API-клиента (пусто, пока не вошли) */
    getHeaders(): Record<string, string>;
    /** Access-токен (для push-соединения, где заголовков нет); `null`, пока не вошли */
    getAccessToken(): string | null;
    /** Входит по адресу и паролю; при отказе бросает `ApiError` */
    login(email: string, password: string): Promise<void>;
    /** Восстанавливает сессию по refresh-cookie (при загрузке страницы) */
    restore(): Promise<void>;
    /** Обновляет access по refresh-cookie; параллельные вызовы сливаются в один запрос */
    refresh(): Promise<boolean>;
    /** Отзывает refresh-токен и переводит сессию в «не вошли» */
    logout(): Promise<void>;
}

/**
 * Ответ сервера с токеном доступа
 */
interface TokenResponse {
    /** Токен доступа */
    accessToken: string;
}

/**
 * Параметры сессии входа
 */
export interface AuthSessionOptions {
    /** API-клиент без повтора при 401 (иначе обновление токена зациклится) */
    api: ApiClient;
}

/**
 * Состояние входа. Access-токен живёт только в замыкании (в памяти вкладки), в хранилища не пишется
 */
export function createAuthSession({ api }: AuthSessionOptions): AuthSession {
    let accessToken: string | null = null;
    let state: AuthState = { status: 'loading' };
    let inflightRefresh: Promise<boolean> | null = null;
    const listeners = new Set<() => void>();

    function setSession(token: string | null) {
        accessToken = token;
        state = { status: token ? 'authenticated' : 'anonymous' };
        listeners.forEach((listener) => listener());
    }

    async function doRefresh(): Promise<boolean> {
        try {
            const { accessToken: token } = await api.post<TokenResponse>('/auth/refresh');
            setSession(token);
            return true;
        } catch {
            setSession(null);
            return false;
        }
    }

    function refresh(): Promise<boolean> {
        inflightRefresh ??= doRefresh().finally(() => {
            inflightRefresh = null;
        });
        return inflightRefresh;
    }

    return {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getHeaders: (): Record<string, string> =>
            accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        getAccessToken: () => accessToken,
        async login(email, password) {
            const { accessToken: token } = await api.post<TokenResponse>('/auth/login', {
                email,
                password,
            });
            setSession(token);
        },
        async restore() {
            await refresh();
        },
        refresh,
        async logout() {
            try {
                await api.post('/auth/logout');
            } catch {
                // сервер недоступен: локально сессию всё равно завершаем
            }
            setSession(null);
        },
    };
}
