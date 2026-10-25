/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { createApiClient } from '../api/apiClient';
import type { ApiClient } from '../api/apiClient';
import { createAuthSession } from './authSession';
import type { AuthSession, AuthState } from './authSession';

interface AuthContextValue {
    session: AuthSession;
    /** API-клиент с access-токеном и однократным обновлением при 401. */
    api: ApiClient;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function useAuthContext(): AuthContextValue {
    const value = useContext(AuthContext);
    if (!value) throw new Error('AuthProvider не найден в дереве компонентов.');
    return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [value] = useState<AuthContextValue>(() => {
        // Клиент без повтора для самих эндпоинтов /auth/*, иначе обновление токена зациклится.
        const session = createAuthSession({ api: createApiClient() });
        const api = createApiClient({
            getHeaders: session.getHeaders,
            onUnauthorized: session.refresh,
        });
        return { session, api };
    });

    useEffect(() => {
        void value.session.restore();
    }, [value]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState & Pick<AuthSession, 'login' | 'logout'> {
    const { session } = useAuthContext();
    const state = useSyncExternalStore(session.subscribe, session.getState);
    return { ...state, login: session.login, logout: session.logout };
}

export function useApi(): ApiClient {
    return useAuthContext().api;
}
