import { JournalTab } from './JournalTab';

import type { MenuRegistry, TabRegistry } from '@platform/tabs/registries';

/**
 * Регистрирует вкладку «Журнал» и пункт меню «Вид → Журнал»
 */
export function registerJournal(tabs: TabRegistry, menu: MenuRegistry): void {
    tabs.register({ id: 'journal', title: 'Журнал', component: JournalTab });
    menu.register({ path: ['Вид', 'Журнал'], run: ({ openTab }) => openTab('journal') });
}
