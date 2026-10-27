import { CommandsTab } from './CommandsTab';

import type { MenuRegistry, TabRegistry } from '@platform/tabs/registries';

/**
 * Регистрирует вид вкладки «Команды» (`commands`) и пункт меню «Вид → Команды»
 */
export function registerCommands(tabs: TabRegistry, menu: MenuRegistry) {
    tabs.register({ id: 'commands', title: 'Команды', component: CommandsTab });
    menu.register({
        path: ['Вид', 'Команды'],
        run: (context) => context.openTab('commands'),
    });
}
