import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Badge } from './Badge';
import { Button, IconButton } from './Button';

/**
 * Кнопка UI-кита: вид, тип по умолчанию, иконка и доступность
 */
describe('Button: rendering', () => {
    /**
     * Проверяет, что без указания типа кнопка не отправляет форму
     */
    it('button_withoutType_isTypeButton', () => {
        render(<Button>Сохранить</Button>);

        expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveAttribute('type', 'button');
    });

    /**
     * Проверяет, что вид кнопки задаёт модификатор класса, а по умолчанию вид обычный
     */
    it('button_variant_setsModifierClass', () => {
        render(
            <>
                <Button>Обычная</Button>
                <Button variant="primary">Главная</Button>
            </>,
        );

        expect(screen.getByRole('button', { name: 'Обычная' })).toHaveClass('btn--secondary');
        expect(screen.getByRole('button', { name: 'Главная' })).toHaveClass('btn--primary');
    });

    /**
     * Проверяет, что иконка выводится перед подписью и не попадает в доступное имя
     */
    it('button_withIcon_rendersIconBeforeLabel', () => {
        render(<Button icon="plus">Добавить</Button>);

        const button = screen.getByRole('button', { name: 'Добавить' });
        expect(button.querySelector('svg[data-icon="plus"]')).not.toBeNull();
    });

    /**
     * Проверяет, что недоступная кнопка не вызывает обработчик
     */
    it('button_disabled_doesNotCallOnClick', async () => {
        const onClick = vi.fn();
        render(
            <Button disabled onClick={onClick}>
                Удалить
            </Button>,
        );

        await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));

        expect(onClick).not.toHaveBeenCalled();
    });
});

/**
 * Кнопка-значок: имя берётся из подписи
 */
describe('IconButton: accessibility', () => {
    /**
     * Проверяет, что подпись становится доступным именем и подсказкой
     */
    it('iconButton_label_isAccessibleNameAndTitle', () => {
        render(<IconButton icon="x" label="Закрыть" />);

        const button = screen.getByRole('button', { name: 'Закрыть' });
        expect(button).toHaveAttribute('title', 'Закрыть');
        expect(button).toHaveClass('btn--icon', 'btn--ghost');
    });

    /**
     * Проверяет, что клик вызывает обработчик
     */
    it('iconButton_click_callsOnClick', async () => {
        const onClick = vi.fn();
        render(<IconButton icon="x" label="Закрыть" onClick={onClick} />);

        await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

/**
 * Метка: тон задаёт модификатор, текст остаётся доступным
 */
describe('Badge: rendering', () => {
    /**
     * Проверяет, что по умолчанию метка нейтральная, а тон меняет модификатор
     */
    it('badge_tone_setsModifierClass', () => {
        render(
            <>
                <Badge>Черновик</Badge>
                <Badge tone="danger">Просрочено</Badge>
            </>,
        );

        expect(screen.getByText('Черновик')).toHaveClass('badge--neutral');
        expect(screen.getByText('Просрочено')).toHaveClass('badge--danger');
    });
});
