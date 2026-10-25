import { useCallback, useEffect, useMemo, useState } from 'react';

import { loadLayout, saveLayout } from '@platform/tabs/layoutStorage';
import { DEFAULT_WIDTHS, TabsContext } from '@platform/tabs/TabsContext';

import type { ReactNode } from 'react';
import type { StoredLayout } from '@platform/tabs/layoutStorage';
import type { TabRegistry } from '@platform/tabs/registries';
import type { TabsValue } from '@platform/tabs/TabsContext';

export interface TabsProviderProps {
    registry: TabRegistry;
    /** Пользователь, чья раскладка хранится в `localStorage` */
    userId: string;
    children: ReactNode;
}

function initialLayout(registry: TabRegistry, userId: string): StoredLayout {
    const stored = loadLayout(userId);
    if (!stored) return { tabs: [], activeId: null, widths: DEFAULT_WIDTHS };
    const tabs = stored.tabs.filter((t) => registry.get(t.kind));
    const activeId = tabs.some((t) => t.id === stored.activeId)
        ? stored.activeId
        : (tabs[0]?.id ?? null);
    return { tabs, activeId, widths: stored.widths };
}

/** Состояние раскладки: открытые вкладки, активная вкладка и ширины панелей (запоминаются для пользователя) */
export function TabsProvider({ registry, userId, children }: TabsProviderProps) {
    const [layout, setLayout] = useState(() => initialLayout(registry, userId));

    useEffect(() => {
        saveLayout(userId, layout);
    }, [userId, layout]);

    const openTab = useCallback(
        (kindId: string) => {
            const kind = registry.get(kindId);
            if (!kind) return;
            setLayout((prev) => {
                if (!kind.multiple) {
                    const existing = prev.tabs.find((t) => t.kind === kindId);
                    if (existing) return { ...prev, activeId: existing.id };
                }
                let n = 1;
                while (prev.tabs.some((t) => t.id === `${kindId}#${n}`)) n++;
                const tab = { id: `${kindId}#${n}`, kind: kindId };
                return { ...prev, tabs: [...prev.tabs, tab], activeId: tab.id };
            });
        },
        [registry],
    );

    const closeTab = useCallback((id: string) => {
        setLayout((prev) => {
            const index = prev.tabs.findIndex((t) => t.id === id);
            if (index < 0) return prev;
            const tabs = prev.tabs.filter((t) => t.id !== id);
            const activeId =
                prev.activeId === id
                    ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
                    : prev.activeId;
            return { ...prev, tabs, activeId };
        });
    }, []);

    const activate = useCallback((id: string) => {
        setLayout((prev) =>
            prev.tabs.some((t) => t.id === id) ? { ...prev, activeId: id } : prev,
        );
    }, []);

    const setWidths = useCallback((widths: StoredLayout['widths']) => {
        setLayout((prev) => ({ ...prev, widths }));
    }, []);

    const value = useMemo<TabsValue>(
        () => ({
            registry,
            tabs: layout.tabs,
            activeId: layout.activeId,
            widths: layout.widths,
            openTab,
            closeTab,
            activate,
            setWidths,
        }),
        [registry, layout, openTab, closeTab, activate, setWidths],
    );

    return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}
