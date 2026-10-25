import { useEffect, useState } from 'react';

import type { UserRole } from '../tabs/registries';
import { useApi } from './AuthProvider';

export interface CurrentUser {
    id: string;
    role: UserRole;
}

interface MeResponse {
    id?: string;
    isAdmin?: boolean;
}

/** Текущий пользователь (`GET /api/auth/me`). `undefined` — ещё загружается; при ошибке — гость с ролью участника. */
export function useCurrentUser(): CurrentUser | undefined {
    const api = useApi();
    const [user, setUser] = useState<CurrentUser>();

    useEffect(() => {
        let cancelled = false;
        api.get<MeResponse>('/auth/me')
            .then(
                (me) => ({ id: me.id ?? 'guest', role: me.isAdmin ? 'admin' : 'member' }) as const,
            )
            .catch(() => ({ id: 'guest', role: 'member' }) as const)
            .then((u) => {
                if (!cancelled) setUser(u);
            });
        return () => {
            cancelled = true;
        };
    }, [api]);

    return user;
}
