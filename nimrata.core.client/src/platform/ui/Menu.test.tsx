import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu } from './Menu';

import type { MenuEntry } from './Menu';

/**
 * Пункты для проверок: обычный, недоступный и опасный
 */
function entries(onSelect = vi.fn()): MenuEntry[] {
    return [
        { id: 'rename', label: 'Переименовать', icon: 'pencil', shortcut: 'F2', onSelect },
        { id: 'copy', label: 'Копировать', disabled: true, onSelect },
        { id: 'delete', label: 'Удалить', danger: true, onSelect },
    ];
}

/**
 * Выпадающее меню: открытие, выбор, клавиатура и закрытие
 */
describe('Menu: interaction', () => {
    /**
     * Проверяет, что меню закрыто, пока кнопку не нажмут, и кнопка сообщает о состоянии
     */
    it('menu_initially_isClosedAndTriggerCollapsed', () => {
        render(<Menu label="Действия" items={entries()} />);

        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Действия' })).toHaveAttribute(
            'aria-expanded',
            'false',
        );
    });

    /**
     * Проверяет, что клик открывает меню и ставит фокус на первый доступный пункт
     */
    it('menu_click_opensAndFocusesFirstItem', async () => {
        render(<Menu label="Действия" items={entries()} />);

        await userEvent.click(screen.getByRole('button', { name: 'Действия' }));

        expect(screen.getByRole('menu', { name: 'Действия' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /Переименовать/ })).toHaveFocus();
    });

    /**
     * Проверяет, что выбор пункта вызывает его обработчик и закрывает меню
     */
    it('menu_selectItem_callsOnSelectAndCloses', async () => {
        const onSelect = vi.fn();
        render(<Menu label="Действия" items={entries(onSelect)} />);
        await userEvent.click(screen.getByRole('button', { name: 'Действия' }));

        await userEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    /**
     * Проверяет, что недоступный пункт отключён и его обработчик не вызывается
     */
    it('menu_disabledItem_isDisabled', async () => {
        const onSelect = vi.fn();
        render(<Menu label="Действия" items={entries(onSelect)} />);
        await userEvent.click(screen.getByRole('button', { name: 'Действия' }));

        const item = screen.getByRole('menuitem', { name: 'Копировать' });
        await userEvent.click(item);

        expect(item).toBeDisabled();
        expect(onSelect).not.toHaveBeenCalled();
    });

    /**
     * Проверяет, что стрелки двигают фокус по доступным пунктам по кругу
     */
    it('menu_arrowKeys_moveFocusSkippingDisabledAndWrapping', async () => {
        render(<Menu label="Действия" items={entries()} />);
        await userEvent.click(screen.getByRole('button', { name: 'Действия' }));

        await userEvent.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem', { name: /Переименовать/ })).toHaveFocus();
        await userEvent.keyboard('{ArrowUp}');
        expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus();
        await userEvent.keyboard('{Home}');
        expect(screen.getByRole('menuitem', { name: /Переименовать/ })).toHaveFocus();
        await userEvent.keyboard('{End}');
        expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus();
    });

    /**
     * Проверяет, что Esc закрывает меню и возвращает фокус на кнопку
     */
    it('menu_escape_closesAndRestoresFocusToTrigger', async () => {
        render(<Menu label="Действия" items={entries()} />);
        await userEvent.click(screen.getByRole('button', { name: 'Действия' }));

        await userEvent.keyboard('{Escape}');

        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Действия' })).toHaveFocus();
    });

    /**
     * Проверяет, что клик вне меню закрывает его
     */
    it('menu_clickOutside_closes', async () => {
        render(
            <>
                <Menu label="Действия" items={entries()} />
                <p>Снаружи</p>
            </>,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Действия' }));

        await userEvent.click(screen.getByText('Снаружи'));

        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    /**
     * Проверяет, что с текстом в children кнопка показывает его, а подсказка о клавишах скрыта
     */
    it('menu_withText_showsTextTriggerAndShortcutAsKeyshortcut', async () => {
        render(
            <Menu label="Действия" items={entries()}>
                Файл
            </Menu>,
        );

        await userEvent.click(screen.getByRole('button', { name: 'Файл' }));

        expect(screen.getByRole('menuitem', { name: /Переименовать/ })).toHaveAttribute(
            'aria-keyshortcuts',
            'F2',
        );
    });
});
