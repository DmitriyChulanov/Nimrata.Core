import { useEffect, useId, useRef } from 'react';

import { classNames } from './classNames';
import './Dialog.css';

import type { KeyboardEvent, ReactNode } from 'react';

/**
 * Селектор элементов, которые могут получить фокус клавиатурой
 */
const FOCUSABLE =
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Свойства модального диалога
 */
export interface DialogProps {
    /** Заголовок; он же название диалога для вспомогательных технологий */
    title: string;
    /** Закрывает диалог по клавише Esc; обработчик решает, можно ли закрыть */
    onClose(): void;
    /** Содержимое диалога */
    children?: ReactNode;
    /** Кнопки действий внизу диалога */
    actions?: ReactNode;
    /** Роль: `alertdialog` — для подтверждений, требующих немедленного ответа */
    role?: 'dialog' | 'alertdialog';
    /** Класс панели диалога */
    className?: string;
}

/**
 * Модальный диалог: удерживает фокус внутри, закрывается по Esc, возвращает фокус при закрытии
 *
 * @param props - заголовок, содержимое, действия и обработчик закрытия
 * @returns подложка с панелью диалога
 */
export function Dialog({
    title,
    onClose,
    children,
    actions,
    role = 'dialog',
    className,
}: DialogProps) {
    const titleId = useId();
    const panel = useRef<HTMLDivElement>(null);

    // При открытии фокус уходит внутрь диалога, при закрытии возвращается на прежний элемент
    useEffect(() => {
        const previous =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
        (first ?? panel.current)?.focus();
        return () => previous?.focus();
    }, []);

    function handleKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key !== 'Tab' || !panel.current) return;
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) {
            event.preventDefault();
            return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    return (
        <div className="dialog-backdrop">
            <div
                ref={panel}
                role={role}
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={classNames('dialog', className)}
                onKeyDown={handleKeyDown}
            >
                <h2 id={titleId} className="dialog__title">
                    {title}
                </h2>
                {children && <div className="dialog__body">{children}</div>}
                {actions && <div className="dialog__actions">{actions}</div>}
            </div>
        </div>
    );
}
