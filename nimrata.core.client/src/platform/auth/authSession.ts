import type { ApiClient } from '@platform/api/apiClient';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthState {
    status: AuthStatus;
}

export interface AuthSession {
    getState(): AuthState;
    subscribe(listener: () => void): () => void;
    /** Заголовки с access-токеном для API-клиента (пусто, пока не вошли) */
    getHeaders(): Record<string, string>;
    login(email: string, password: string): Promise<void>;
    /** Восстанавливает сессию по refresh-cookie (при загрузке страницы) */
    restore(): Promise<void>;
    /** Обновляет access по refresh-cookie; параллельные вызовы сливаются в один запрос */
    refresh(): Promise<boolean>;
    logout(): Promise<void>;
}

interface TokenResponse {
    accessToken: string;
}

export interface AuthSessionOptions {
    /** API-клиент без повтора при 401 (иначе обновление токена зациклится) */
    api: ApiClient;
}

/** Состояние входа. Access-токен живёт только в замыкании (в памяти вкладки), в хранилища не пишется */
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
