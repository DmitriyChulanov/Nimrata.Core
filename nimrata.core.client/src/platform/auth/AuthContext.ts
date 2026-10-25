import { createContext } from 'react';

import type { ApiClient } from '@platform/api/apiClient';
import type { AuthSession } from '@platform/auth/authSession';

/** Значение контекста авторизации */
export interface AuthContextValue {
    session: AuthSession;
    /** API-клиент с access-токеном и однократным обновлением при 401 */
    api: ApiClient;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
