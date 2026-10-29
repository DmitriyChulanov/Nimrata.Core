import { useCallback, useSyncExternalStore } from 'react';

import { useDataController } from '@platform/data/useDataController';

import type { DataObject } from '@platform/data/DataController';

/**
 * Объект модели по идентификатору; компонент перерисовывается только при изменении этого объекта
 * (в том числе появлении и удалении)
 *
 * @param id - идентификатор объекта; `null` или `undefined` — объекта нет
 * @returns объект или `undefined`, если его нет
 */
export function useObject(id: string | null | undefined): DataObject | undefined {
    const data = useDataController();
    const subscribe = useCallback(
        (listener: () => void) => (id ? data.subscribeObject(id, listener) : () => {}),
        [data, id],
    );
    return useSyncExternalStore(subscribe, () => (id ? data.getObject(id) : undefined));
}
