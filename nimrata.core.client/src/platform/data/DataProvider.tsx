import { DataContext } from '@platform/data/DataContext';

import type { ReactNode } from 'react';
import type { DataController } from '@platform/data/DataController';

/** Отдаёт `DataController` остальным компонентам платформы */
export function DataProvider({
    controller,
    children,
}: {
    controller: DataController;
    children: ReactNode;
}) {
    return <DataContext.Provider value={controller}>{children}</DataContext.Provider>;
}
