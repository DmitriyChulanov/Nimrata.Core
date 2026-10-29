import { useContext } from 'react';

import { DataContext } from '@platform/data/DataContext';

import type { DataController } from '@platform/data/DataController';

/**
 * Контроллер данных без подписки на модель: компонент не перерисовывается при изменениях данных.
 * Для чтения данных при отрисовке — `useObject`, `useChildren`, `useQuery` или `useData`
 *
 * @returns контроллер из ближайшего `DataProvider`
 * @throws {Error} вне `DataProvider`
 */
export function useDataController(): DataController {
    const controller = useContext(DataContext);
    if (!controller) throw new Error('DataProvider не найден в дереве компонентов.');
    return controller;
}
