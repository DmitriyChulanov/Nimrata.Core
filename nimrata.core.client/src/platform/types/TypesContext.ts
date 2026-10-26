import { createContext } from 'react';

import type { TypeDefinition } from '@platform/types/types';

/**
 * Состояние загрузки типов
 */
export type TypesStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Значение контекста типов
 */
export interface TypesContextValue {
    /** Состояние загрузки */
    status: TypesStatus;
    /** Загруженные типы */
    types: TypeDefinition[];
    /** Тип по идентификатору */
    getType(id: string): TypeDefinition | undefined;
}

/**
 * Контекст типов; `null` вне `TypesProvider`
 */
export const TypesContext = createContext<TypesContextValue | null>(null);
