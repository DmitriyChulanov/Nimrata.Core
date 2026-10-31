import { useCallback, useSyncExternalStore } from 'react';

import { useDataController } from '@platform/data/useDataController';

import type { DataObject } from '@platform/data/DataController';

/**
 * Дети родителя по возрастанию номера; компонент перерисовывается только при изменении состава,
 * порядка или самих детей этого родителя
 *
 * @param parent - идентификатор родителя; `null` — корневые объекты
 * @returns неизменяемый список детей (ссылка сохраняется, пока дети не изменились)
 */
export function useChildren(parent: string | null): readonly DataObject[] {
    const data = useDataController();
    const subscribe = useCallback(
        (listener: () => void) => data.subscribeChildren(parent, listener),
        [data, parent],
    );
    return useSyncExternalStore(subscribe, () => data.getChildren(parent));
}
