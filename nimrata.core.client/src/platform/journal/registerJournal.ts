import type { MenuRegistry, TabRegistry } from '../tabs/registries';
import { JournalTab } from './JournalTab';

/** Регистрирует вкладку «Журнал» и пункт меню «Вид → Журнал». */
export function registerJournal(tabs: TabRegistry, menu: MenuRegistry): void {
    tabs.register({ id: 'journal', title: 'Журнал', component: JournalTab });
    menu.register({ path: ['Вид', 'Журнал'], run: ({ openTab }) => openTab('journal') });
}
