import { useContext } from 'react';

import { AuthContext } from '@platform/auth/AuthContext';

import type { AuthContextValue } from '@platform/auth/AuthContext';

/** Контекст авторизации; бросает ошибку вне `AuthProvider` */
export function useAuthContext(): AuthContextValue {
    const value = useContext(AuthContext);
    if (!value) throw new Error('AuthProvider не найден в дереве компонентов.');
    return value;
}
