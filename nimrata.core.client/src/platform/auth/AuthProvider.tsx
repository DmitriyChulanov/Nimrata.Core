import { useEffect, useState } from 'react';

import { createApiClient } from '@platform/api/apiClient';
import { AuthContext } from '@platform/auth/AuthContext';
import { createAuthSession } from '@platform/auth/authSession';

import type { ReactNode } from 'react';
import type { AuthContextValue } from '@platform/auth/AuthContext';

/**
 * Создаёт сессию входа и API-клиента и раздаёт их потомкам; при загрузке пробует восстановить
 * сессию, а в состоянии «офлайн» — обновить её, когда вернётся сеть
 *
 * @param props - дочерние элементы, которым нужна авторизация
 * @returns контекст авторизации вокруг потомков
 */
export function AuthProvider({ children }: { children: ReactNode }) {
    const [value] = useState<AuthContextValue>(() => {
        // Клиент без повтора для самих эндпоинтов /auth/*, иначе обновление токена зациклится
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

    // Сеть вернулась, а вход не проверен («офлайн»): обновляем — сервер решит, действителен ли он
    useEffect(() => {
        const onOnline = () => {
            if (value.session.getState().status === 'offline') void value.session.refresh();
        };
        window.addEventListener('online', onOnline);
        return () => window.removeEventListener('online', onOnline);
    }, [value]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
