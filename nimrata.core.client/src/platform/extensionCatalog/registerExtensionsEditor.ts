import { ExtensionsEditor } from './ExtensionsEditor';

import type { MenuRegistry, TabRegistry } from '@platform/tabs/registries';

/**
 * Регистрирует вид вкладки «Расширения» (одна копия) и пункт меню «Вид → Расширения»
 *
 * @param tabs - реестр видов вкладок
 * @param menu - реестр пунктов главного меню
 */
export function registerExtensionsEditor(tabs: TabRegistry, menu: MenuRegistry): void {
    tabs.register({ id: 'extensions', title: 'Расширения', component: ExtensionsEditor });
    menu.register({ path: ['Вид', 'Расширения'], run: ({ openTab }) => openTab('extensions') });
}
