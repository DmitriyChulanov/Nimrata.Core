import { useContext } from 'react';

import { SelectionContext } from '@platform/selection/SelectionContext';

import type { SelectionValue } from '@platform/selection/SelectionContext';

/**
 * Выделение в дереве; бросает ошибку вне `SelectionProvider`
 */
export function useSelection(): SelectionValue {
    const value = useContext(SelectionContext);
    if (!value) throw new Error('SelectionProvider не найден в дереве компонентов.');
    return value;
}
