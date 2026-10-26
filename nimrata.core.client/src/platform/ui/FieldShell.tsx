import { classNames } from './classNames';
import './Field.css';

import type { ReactNode } from 'react';
import type { FieldIds } from './fieldIds';

/**
 * Свойства подписи, подсказки и ошибки, общие для всех полей формы
 */
export interface FieldMessages {
    /** Подпись поля */
    label: string;
    /** Пояснение под полем */
    hint?: string;
    /** Сообщение об ошибке; задаёт состояние ошибки поля */
    error?: string;
    /** Класс корневого элемента поля */
    wrapperClassName?: string;
}

/**
 * Свойства оболочки поля
 */
interface FieldShellProps extends FieldMessages {
    /** Идентификаторы связанных элементов */
    ids: FieldIds;
    /** Элемент ввода */
    children: ReactNode;
}

/**
 * Оболочка поля формы: подпись, элемент ввода, подсказка и сообщение об ошибке
 *
 * @param props - подпись, сообщения, идентификаторы и элемент ввода
 * @returns разметка поля
 */
export function FieldShell({
    label,
    hint,
    error,
    wrapperClassName,
    ids,
    children,
}: FieldShellProps) {
    return (
        <div className={classNames('field', wrapperClassName)}>
            <label className="field__label" htmlFor={ids.control}>
                {label}
            </label>
            {children}
            {hint && (
                <p id={ids.hint} className="field__hint">
                    {hint}
                </p>
            )}
            {error && (
                <p id={ids.error} className="field__error" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
