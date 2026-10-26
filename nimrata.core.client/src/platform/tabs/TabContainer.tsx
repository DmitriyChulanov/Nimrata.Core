import { Icon } from '@platform/icons/Icon';

import { useTabs } from './useTabs';
import './Tabs.css';

/**
 * Контейнер вкладок: полоса заголовков и содержимое активной вкладки
 */
export function TabContainer() {
    const { tabs, activeId, registry, activate, closeTab } = useTabs();
    const active = tabs.find((t) => t.id === activeId);
    const Active = active ? registry.get(active.kind)?.component : undefined;

    return (
        <div className="tabs">
            <div role="tablist" className="tabs-strip">
                {tabs.map((tab) => {
                    const title = registry.get(tab.kind)?.title ?? tab.kind;
                    const selected = tab.id === activeId;
                    return (
                        <span key={tab.id} className="tabs-item" data-selected={selected}>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                onClick={() => activate(tab.id)}
                            >
                                {title}
                            </button>
                            <button
                                type="button"
                                aria-label={`Закрыть вкладку ${title}`}
                                onClick={() => closeTab(tab.id)}
                            >
                                <Icon name="x" size="sm" />
                            </button>
                        </span>
                    );
                })}
            </div>
            <div role="tabpanel" className="tabs-panel">
                {Active && <Active />}
            </div>
        </div>
    );
}
