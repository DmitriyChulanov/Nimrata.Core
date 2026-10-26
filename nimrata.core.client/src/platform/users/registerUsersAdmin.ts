import { UsersTab } from './UsersTab';

import type { MenuRegistry, TabRegistry } from '@platform/tabs/registries';

/**
 * Идентификатор вида вкладки «Пользователи»
 */
export const USERS_TAB_ID = 'platform.users';

/**
 * Регистрирует вкладку «Пользователи» и пункт «Администрирование → Пользователи» (виден только администратору). Повторный вызов безопасен
 */
export function registerUsersAdmin(tabs: TabRegistry, menu: MenuRegistry): void {
    if (tabs.get(USERS_TAB_ID)) return;
    tabs.register({ id: USERS_TAB_ID, title: 'Пользователи', component: UsersTab });
    menu.register({
        path: ['Администрирование', 'Пользователи'],
        role: 'admin',
        run: (context) => context.openTab(USERS_TAB_ID),
    });
}
