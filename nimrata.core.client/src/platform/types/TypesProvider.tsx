import { useEffect, useMemo, useState } from 'react';

import { useApi } from '@platform/auth/useApi';
import { useAuth } from '@platform/auth/useAuth';
import { TypesContext } from '@platform/types/TypesContext';

import type { ReactNode } from 'react';
import type { TypesContextValue, TypesStatus } from '@platform/types/TypesContext';
import type { TypeDefinition } from '@platform/types/types';

/**
 * Итог загрузки типов
 */
interface LoadedTypes {
    /** Загрузка завершилась успехом или ошибкой */
    status: Extract<TypesStatus, 'ready' | 'error'>;
    /** Загруженные типы */
    types: TypeDefinition[];
}

/**
 * Значение контекста до загрузки типов
 */
const emptyValue: TypesContextValue = { status: 'idle', types: [], getType: () => undefined };

/**
 * Загружает типы после входа и хранит их для остальной платформы; при выходе очищает
 */
export function TypesProvider({ children }: { children: ReactNode }) {
    const { status: authStatus } = useAuth();
    const api = useApi();
    const [loaded, setLoaded] = useState<LoadedTypes | null>(null);

    useEffect(() => {
        if (authStatus !== 'authenticated') return;
        let cancelled = false;
        api.get<TypeDefinition[]>('types').then(
            (types) => {
                if (cancelled) return;
                setLoaded(
                    Array.isArray(types)
                        ? { status: 'ready', types }
                        : { status: 'error', types: [] },
                );
            },
            () => {
                if (!cancelled) setLoaded({ status: 'error', types: [] });
            },
        );
        return () => {
            cancelled = true;
            setLoaded(null);
        };
    }, [authStatus, api]);

    const value = useMemo<TypesContextValue>(() => {
        if (authStatus !== 'authenticated') return emptyValue;
        if (!loaded) return { status: 'loading', types: [], getType: () => undefined };
        const byId = new Map(loaded.types.map((t) => [t.id, t]));
        return { ...loaded, getType: (id) => byId.get(id) };
    }, [authStatus, loaded]);

    return <TypesContext.Provider value={value}>{children}</TypesContext.Provider>;
}
