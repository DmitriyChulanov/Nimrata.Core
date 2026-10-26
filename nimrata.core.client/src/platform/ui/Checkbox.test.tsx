import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './Checkbox';

/**
 * Флажок: подпись связана с элементом, состояние переключается кликом
 */
describe('Checkbox: interaction', () => {
    /**
     * Проверяет, что клик по подписи переключает флажок и вызывает обработчик
     */
    it('checkbox_clickLabel_togglesAndCallsOnChange', async () => {
        const onChange = vi.fn();
        render(<Checkbox label="Срочно" onChange={onChange} />);

        await userEvent.click(screen.getByText('Срочно'));

        expect(screen.getByRole('checkbox', { name: 'Срочно' })).toBeChecked();
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что недоступный флажок нельзя переключить
     */
    it('checkbox_disabled_doesNotToggle', async () => {
        render(<Checkbox label="Срочно" disabled />);

        await userEvent.click(screen.getByText('Срочно'));

        expect(screen.getByRole('checkbox', { name: 'Срочно' })).not.toBeChecked();
    });
});
