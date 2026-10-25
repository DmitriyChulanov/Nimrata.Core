import { createContext } from 'react';

import type { DataController } from '@platform/data/DataController';

export const DataContext = createContext<DataController | null>(null);
