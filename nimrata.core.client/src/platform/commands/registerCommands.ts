import { CommandsTab } from './CommandsTab';

import type { MenuRegistry, TabRegistry } from '@platform/tabs/registries';

/**
 * Регистрирует вид вкладки «Команды» (`commands`, открывается при каждом запуске) и пункт меню
 * «Вид → Команды»
 */
export function registerCommands(tabs: TabRegistry, menu: MenuRegistry) {
    tabs.register({ id: 'commands', title: 'Команды', component: CommandsTab, openOnStart: true });
    menu.register({
        path: ['Вид', 'Команды'],
        run: (context) => context.openTab('commands'),
    });
}
