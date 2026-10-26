import { AutomationTab } from './AutomationTab';

import type { MenuRegistry, TabRegistry } from '@platform/tabs/registries';

/**
 * Регистрирует вид вкладки «Автоматизация» и пункт меню «Вид → Автоматизация»
 */
export function registerAutomation(tabs: TabRegistry, menu: MenuRegistry) {
    tabs.register({ id: 'automation', title: 'Автоматизация', component: AutomationTab });
    menu.register({
        path: ['Вид', 'Автоматизация'],
        run: (context) => context.openTab('automation'),
    });
}
