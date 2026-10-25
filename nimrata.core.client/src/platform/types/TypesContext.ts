import { createContext } from 'react';

import type { TypeDefinition } from '@platform/types/types';

export type TypesStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TypesContextValue {
    status: TypesStatus;
    types: TypeDefinition[];
    getType(id: string): TypeDefinition | undefined;
}

export const TypesContext = createContext<TypesContextValue | null>(null);
