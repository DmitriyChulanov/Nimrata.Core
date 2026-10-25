import { createContext } from 'react';

import type { OpenTab, StoredLayout } from '@platform/tabs/layoutStorage';
import type { TabRegistry } from '@platform/tabs/registries';

export const DEFAULT_WIDTHS = { left: 280, right: 320 };

export interface TabsValue {
    registry: TabRegistry;
    tabs: OpenTab[];
    activeId: string | null;
    widths: StoredLayout['widths'];
    /** Открывает вкладку вида; для вида с одной копией переключает на уже открытую */
    openTab(kindId: string): void;
    closeTab(id: string): void;
    activate(id: string): void;
    setWidths(widths: StoredLayout['widths']): void;
}

export const TabsContext = createContext<TabsValue | null>(null);
