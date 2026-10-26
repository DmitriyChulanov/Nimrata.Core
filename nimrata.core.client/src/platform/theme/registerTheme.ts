import { setThemeChoice } from './theme';

import type { MenuRegistry } from '@platform/tabs/registries';
import type { ThemeChoice } from './theme';

/**
 * Пункты выбора темы: подпись и значение
 */
const ITEMS: ReadonlyArray<{ label: string; choice: ThemeChoice }> = [
    { label: 'Системная', choice: 'system' },
    { label: 'Светлая', choice: 'light' },
    { label: 'Тёмная', choice: 'dark' },
];

/**
 * Регистрирует пункты меню «Вид → Тема»
 */
export function registerTheme(menu: MenuRegistry): void {
    for (const { label, choice } of ITEMS) {
        menu.register({ path: ['Вид', 'Тема', label], run: () => setThemeChoice(choice) });
    }
}
