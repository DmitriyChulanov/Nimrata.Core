import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch';

/**
 * Переключатель: роль switch, подпись, клавиатура
 */
describe('Switch: interaction', () => {
    /**
     * Проверяет, что переключатель доступен по имени и роли switch и отражает состояние
     */
    it('switch_checked_exposesSwitchRoleAndState', () => {
        render(<Switch label="Подключено" checked onChange={() => {}} />);

        expect(screen.getByRole('switch', { name: 'Подключено' })).toBeChecked();
    });

    /**
     * Проверяет, что клик по подписи вызывает обработчик
     */
    it('switch_clickLabel_callsOnChange', async () => {
        const onChange = vi.fn();
        render(<Switch label="Подключено" checked={false} onChange={onChange} />);

        await userEvent.click(screen.getByText('Подключено'));

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что переключатель получает фокус с клавиатуры и переключается пробелом
     */
    it('switch_keyboardSpace_togglesAfterTabFocus', async () => {
        const onChange = vi.fn();
        render(<Switch label="Подключено" checked={false} onChange={onChange} />);

        await userEvent.tab();
        expect(screen.getByRole('switch')).toHaveFocus();
        await userEvent.keyboard(' ');

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что недоступный переключатель не срабатывает
     */
    it('switch_disabled_doesNotCallOnChange', async () => {
        const onChange = vi.fn();
        render(<Switch label="Подключено" checked={false} disabled onChange={onChange} />);

        await userEvent.click(screen.getByText('Подключено'));

        expect(onChange).not.toHaveBeenCalled();
    });
});
