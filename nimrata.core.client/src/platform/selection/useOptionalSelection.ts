import { useContext } from 'react';

import { SelectionContext } from '@platform/selection/SelectionContext';

import type { SelectionValue } from '@platform/selection/SelectionContext';

/** Выделение, если `SelectionProvider` есть выше по дереву; иначе `null` (для необязательных переходов) */
export function useOptionalSelection(): SelectionValue | null {
    return useContext(SelectionContext);
}
