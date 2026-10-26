import { createContext } from 'react';

import type { OpenTab, StoredLayout } from '@platform/tabs/layoutStorage';
import type { TabRegistry } from '@platform/tabs/registries';

/**
 * Ширины боковых панелей по умолчанию
 */
export const DEFAULT_WIDTHS = { left: 280, right: 320 };

/**
 * Значение контекста вкладок: реестр, открытые вкладки и ширины панелей
 */
export interface TabsValue {
    /** Реестр видов вкладок */
    registry: TabRegistry;
    /** Открытые вкладки по порядку */
    tabs: OpenTab[];
    /** Идентификатор активной вкладки */
    activeId: string | null;
    /** Ширины боковых панелей */
    widths: StoredLayout['widths'];
    /** Открывает вкладку вида; для вида с одной копией переключает на уже открытую */
    openTab(kindId: string): void;
    /** Закрывает вкладку */
    closeTab(id: string): void;
    /** Делает вкладку активной */
    activate(id: string): void;
    /** Запоминает ширины боковых панелей */
    setWidths(widths: StoredLayout['widths']): void;
}

/**
 * Контекст вкладок; `null` вне `TabsProvider`
 */
export const TabsContext = createContext<TabsValue | null>(null);
