import { useId, useState } from 'react';

import { classNames } from './classNames';
import './Tooltip.css';

import type { KeyboardEvent, ReactNode } from 'react';

/**
 * Сторона, к которой подсказка выравнивается под элементом
 */
export type TooltipAlign = 'start' | 'end';

/**
 * Свойства подсказки
 */
export interface TooltipProps {
    /** Текст подсказки; он же описание элемента для скринридера (`aria-describedby`) */
    content: ReactNode;
    /**
     * Элемент, к которому относится подсказка: получает идентификатор подсказки и ставит его
     * в `aria-describedby` своего фокусируемого элемента
     */
    children: (tooltipId: string) => ReactNode;
    /** Выравнивание под элементом; по умолчанию по правому краю (`end`) */
    align?: TooltipAlign;
    /** Дополнительный класс обёртки */
    className?: string;
}

/**
 * Подсказка при наведении и фокусе: показывается под элементом, не перехватывает указатель,
 * скрывается по Esc (WCAG 1.4.13) до ухода указателя или фокуса. Текст всегда в DOM и связан
 * с элементом через `aria-describedby`, поэтому скринридер читает его и без показа
 *
 * @param props - текст, элемент и выравнивание
 * @returns обёртка с элементом и подсказкой
 */
export function Tooltip({ content, children, align = 'end', className }: TooltipProps) {
    const id = useId();
    const [dismissed, setDismissed] = useState(false);

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && !dismissed) setDismissed(true);
    };
    const reset = () => setDismissed(false);

    return (
        <span
            className={classNames(
                'tooltip',
                `tooltip--${align}`,
                dismissed && 'tooltip--dismissed',
                className,
            )}
            onKeyDown={onKeyDown}
            onMouseLeave={reset}
            onBlur={reset}
        >
            {children(id)}
            <span role="tooltip" id={id} className="tooltip__content">
                {content}
            </span>
        </span>
    );
}
