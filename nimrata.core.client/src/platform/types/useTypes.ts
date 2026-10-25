import { useContext } from 'react';

import { TypesContext } from '@platform/types/TypesContext';

import type { TypesContextValue } from '@platform/types/TypesContext';

/** Типы платформы; бросает ошибку вне `TypesProvider` */
export function useTypes(): TypesContextValue {
    const value = useContext(TypesContext);
    if (!value) throw new Error('TypesProvider не найден в дереве компонентов.');
    return value;
}
