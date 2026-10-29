import { useEffect, useState } from 'react';

import { ApiError } from '@platform/api/apiClient';

import { useApi } from './useApi';

import type { UserRole } from '@platform/tabs/registries';

/**
 * Текущий пользователь
 */
export interface CurrentUser {
    /** Идентификатор пользователя */
    id: string;
    /** Роль пользователя */
    role: UserRole;
}

/**
 * Ответ сервера о текущем пользователе
 */
interface MeResponse {
    /** Идентификатор пользователя */
    id?: string;
    /** Признак администратора */
    isAdmin?: boolean;
}

/**
 * Ключ последнего вошедшего пользователя в `localStorage`: без сети по нему открывается его кэш
 */
const REMEMBERED_USER_KEY = 'nimrata.currentUser';

/**
 * Последний вошедший пользователь (для работы без сети); `undefined` — не запомнен
 *
 * @returns идентификатор и роль либо `undefined`
 */
export function rememberedUser(): CurrentUser | undefined {
    try {
        const raw = localStorage.getItem(REMEMBERED_USER_KEY);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as Partial<CurrentUser>;
        if (typeof parsed.id !== 'string') return undefined;
        return { id: parsed.id, role: parsed.role === 'admin' ? 'admin' : 'member' };
    } catch {
        return undefined;
    }
}

/**
 * Забывает последнего вошедшего пользователя (выход)
 */
export function forgetRememberedUser(): void {
    try {
        localStorage.removeItem(REMEMBERED_USER_KEY);
    } catch {
        // хранилище недоступно — помнить и нечего
    }
}

/**
 * Запоминает вошедшего пользователя
 *
 * @param user - текущий пользователь
 */
function rememberUser(user: CurrentUser): void {
    try {
        localStorage.setItem(REMEMBERED_USER_KEY, JSON.stringify(user));
    } catch {
        // без хранилища работа без сети просто не откроется
    }
}

/**
 * Текущий пользователь (`GET /api/auth/me`). `undefined` — ещё загружается. Без сети — последний
 * вошедший (если запомнен), при прочих ошибках — гость с ролью участника
 */
export function useCurrentUser(): CurrentUser | undefined {
    const api = useApi();
    const [user, setUser] = useState<CurrentUser>();

    useEffect(() => {
        let cancelled = false;
        api.get<MeResponse>('/auth/me')
            .then((me) => {
                const known: CurrentUser = {
                    id: me.id ?? 'guest',
                    role: me.isAdmin ? 'admin' : 'member',
                };
                if (me.id) rememberUser(known);
                return known;
            })
            .catch(
                (error: unknown): CurrentUser =>
                    (!(error instanceof ApiError) && rememberedUser()) || {
                        id: 'guest',
                        role: 'member',
                    },
            )
            .then((u) => {
                if (!cancelled) setUser(u);
            });
        return () => {
            cancelled = true;
        };
    }, [api]);

    return user;
}
