import { useEffect, useState } from 'react';

import { createApiClient } from '@platform/api/apiClient';
import { AuthContext } from '@platform/auth/AuthContext';
import { createAuthSession } from '@platform/auth/authSession';

import type { ReactNode } from 'react';
import type { AuthContextValue } from '@platform/auth/AuthContext';

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

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
