import { useSyncExternalStore } from 'react';

import { useAuthContext } from '@platform/auth/useAuthContext';

import type { AuthSession, AuthState } from '@platform/auth/authSession';

/** Состояние авторизации и действия входа и выхода */
export function useAuth(): AuthState & Pick<AuthSession, 'login' | 'logout'> {
    const { session } = useAuthContext();
    const state = useSyncExternalStore(session.subscribe, session.getState);
    return { ...state, login: session.login, logout: session.logout };
}
