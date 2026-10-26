import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Dialog } from './Dialog';

/**
 * Страница с кнопкой, открывающей диалог: проверяет возврат фокуса
 */
function Host() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button onClick={() => setOpen(true)}>Открыть</Button>
            {open && (
                <Dialog
                    title="Параметры"
                    onClose={() => setOpen(false)}
                    actions={
                        <>
                            <Button>Первая</Button>
                            <Button>Вторая</Button>
                        </>
                    }
                >
                    Текст
                </Dialog>
            )}
        </>
    );
}

/**
 * Модальный диалог: имя, фокус, закрытие и роль
 */
describe('Dialog: modality', () => {
    /**
     * Проверяет, что диалог назван по заголовку и помечен модальным
     */
    it('dialog_title_isAccessibleNameAndModal', () => {
        render(<Dialog title="Параметры" onClose={() => undefined} />);

        const dialog = screen.getByRole('dialog', { name: 'Параметры' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    /**
     * Проверяет, что роль alertdialog применяется по запросу
     */
    it('dialog_roleAlertdialog_isApplied', () => {
        render(<Dialog title="Удалить?" role="alertdialog" onClose={() => undefined} />);

        expect(screen.getByRole('alertdialog', { name: 'Удалить?' })).toBeInTheDocument();
    });

    /**
     * Проверяет, что при открытии фокус уходит на первый элемент диалога
     */
    it('dialog_open_focusesFirstFocusable', async () => {
        render(<Host />);

        await userEvent.click(screen.getByRole('button', { name: 'Открыть' }));

        expect(screen.getByRole('button', { name: 'Первая' })).toHaveFocus();
    });

    /**
     * Проверяет, что без управляемых элементов фокус получает сама панель
     */
    it('dialog_withoutFocusable_focusesPanel', () => {
        render(<Dialog title="Параметры" onClose={() => undefined} />);

        expect(screen.getByRole('dialog')).toHaveFocus();
    });

    /**
     * Проверяет, что Esc вызывает закрытие
     */
    it('dialog_escape_callsOnClose', async () => {
        const onClose = vi.fn();
        render(<Dialog title="Параметры" onClose={onClose} actions={<Button>Ок</Button>} />);

        await userEvent.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что Tab с последнего элемента переходит на первый, а Shift+Tab — обратно
     */
    it('dialog_tab_cyclesFocusInsideDialog', async () => {
        render(<Host />);
        await userEvent.click(screen.getByRole('button', { name: 'Открыть' }));

        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Вторая' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Первая' })).toHaveFocus();
        await userEvent.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'Вторая' })).toHaveFocus();
    });

    /**
     * Проверяет, что после закрытия фокус возвращается на кнопку, открывшую диалог
     */
    it('dialog_close_restoresFocusToOpener', async () => {
        render(<Host />);
        await userEvent.click(screen.getByRole('button', { name: 'Открыть' }));

        await userEvent.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Открыть' })).toHaveFocus();
    });
});
