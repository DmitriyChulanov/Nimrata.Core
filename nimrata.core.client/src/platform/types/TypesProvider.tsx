/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { useApi, useAuth } from '../auth/AuthProvider';
import type { TypeDefinition } from './types';

export type TypesStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TypesContextValue {
    status: TypesStatus;
    types: TypeDefinition[];
    getType(id: string): TypeDefinition | undefined;
}

const emptyValue: TypesContextValue = { status: 'idle', types: [], getType: () => undefined };

const TypesContext = createContext<TypesContextValue | null>(null);

/** Загружает типы после входа и хранит их для остальной платформы; при выходе очищает. */
export function TypesProvider({ children }: { children: ReactNode }) {
    const { status: authStatus } = useAuth();
    const api = useApi();
    const [loaded, setLoaded] = useState<{ status: TypesStatus; types: TypeDefinition[] }>({
        status: 'idle',
        types: [],
    });

    useEffect(() => {
        if (authStatus !== 'authenticated') return;
        let cancelled = false;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- явный переход в «loading» перед запросом
        setLoaded({ status: 'loading', types: [] });
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
        };
    }, [authStatus, api]);

    const value = useMemo<TypesContextValue>(() => {
        if (authStatus !== 'authenticated') return emptyValue;
        const byId = new Map(loaded.types.map((t) => [t.id, t]));
        return { ...loaded, getType: (id) => byId.get(id) };
    }, [authStatus, loaded]);

    return <TypesContext.Provider value={value}>{children}</TypesContext.Provider>;
}

export function useTypes(): TypesContextValue {
    const value = useContext(TypesContext);
    if (!value) throw new Error('TypesProvider не найден в дереве компонентов.');
    return value;
}
