import { useContext, useSyncExternalStore } from 'react';

import { DataContext } from '@platform/data/DataContext';

import type { DataController } from '@platform/data/DataController';

/**
 * Контроллер данных; компонент перерисовывается при каждом изменении модели
 */
export function useData(): DataController {
    const controller = useContext(DataContext);
    if (!controller) throw new Error('DataProvider не найден в дереве компонентов.');
    useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    return controller;
}
