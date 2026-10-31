import { useSyncExternalStore } from 'react';

import { useDataController } from '@platform/data/useDataController';

import type { DataController } from '@platform/data/DataController';

/**
 * Контроллер данных; компонент перерисовывается при каждом изменении модели. Только там, где нужна
 * вся модель: для адресного чтения — `useObject`, `useChildren`, `useQuery`
 *
 * @returns контроллер из ближайшего `DataProvider`
 */
export function useData(): DataController {
    const controller = useDataController();
    useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    return controller;
}
