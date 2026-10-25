/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import type { DataController } from './DataController';

const DataContext = createContext<DataController | null>(null);

/** Отдаёт `DataController` остальным компонентам платформы. */
export function DataProvider({
    controller,
    children,
}: {
    controller: DataController;
    children: ReactNode;
}) {
    return <DataContext.Provider value={controller}>{children}</DataContext.Provider>;
}

/** Контроллер данных; компонент перерисовывается при каждом изменении модели. */
export function useData(): DataController {
    const controller = useContext(DataContext);
    if (!controller) throw new Error('DataProvider не найден в дереве компонентов.');
    useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    return controller;
}
