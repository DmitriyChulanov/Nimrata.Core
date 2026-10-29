import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { Tooltip } from './Tooltip';

/**
 * Рисует кнопку с подсказкой
 *
 * @returns результат отрисовки
 */
function renderTooltip() {
    return render(
        <Tooltip content="Подробности" align="start" className="extra">
            {(id) => <Button aria-describedby={id}>Действие</Button>}
        </Tooltip>,
    );
}

/**
 * Подсказка UI-кита: связь с элементом, выравнивание, скрытие по Esc
 */
describe('Tooltip', () => {
    /**
     * Проверяет, что текст подсказки — доступное описание элемента
     */
    it('tooltip_linkedToTrigger_viaAriaDescribedby', () => {
        renderTooltip();

        expect(screen.getByRole('button', { name: 'Действие' })).toHaveAccessibleDescription(
            'Подробности',
        );
        expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Подробности');
    });

    /**
     * Проверяет классы обёртки: выравнивание и дополнительный класс
     */
    it('tooltip_alignAndClassName_appliedToWrapper', () => {
        renderTooltip();

        const wrapper = screen.getByRole('tooltip', { hidden: true }).parentElement;
        expect(wrapper).toHaveClass('tooltip', 'tooltip--start', 'extra');
    });

    /**
     * Проверяет, что Esc скрывает подсказку, а уход фокуса возвращает обычное поведение
     */
    it('tooltip_escape_dismissedUntilFocusLeaves', async () => {
        const user = userEvent.setup();
        renderTooltip();
        const wrapper = screen.getByRole('tooltip', { hidden: true }).parentElement;

        await user.tab();
        await user.keyboard('{Escape}');
        expect(wrapper).toHaveClass('tooltip--dismissed');

        fireEvent.blur(screen.getByRole('button', { name: 'Действие' }));
        expect(wrapper).not.toHaveClass('tooltip--dismissed');
    });
});
