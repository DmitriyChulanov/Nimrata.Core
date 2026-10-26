import { createContext } from 'react';

import type { DataController } from '@platform/data/DataController';

/**
 * Контекст контроллера данных; `null` вне `DataProvider`
 */
export const DataContext = createContext<DataController | null>(null);
