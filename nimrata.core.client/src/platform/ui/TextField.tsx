import { classNames } from './classNames';
import { controlAria, useFieldIds } from './fieldIds';
import { FieldShell } from './FieldShell';

import type { ComponentProps } from 'react';
import type { FieldMessages } from './FieldShell';

/**
 * Свойства однострочного поля: стандартные свойства `input`
 */
export interface TextFieldProps
    extends FieldMessages, Omit<ComponentProps<'input'>, 'children' | 'aria-invalid'> {}

/**
 * Подписанное однострочное поле: связывает подпись, подсказку и ошибку с элементом ввода
 *
 * @param props - подпись, подсказка, ошибка и свойства `input`
 * @returns поле формы
 */
export function TextField({
    label,
    hint,
    error,
    wrapperClassName,
    id,
    className,
    type = 'text',
    ...props
}: TextFieldProps) {
    const ids = useFieldIds(id);

    return (
        <FieldShell
            label={label}
            hint={hint}
            error={error}
            wrapperClassName={wrapperClassName}
            ids={ids}
        >
            <input
                type={type}
                {...props}
                {...controlAria(ids, { hint, error })}
                className={classNames('field__control', className)}
            />
        </FieldShell>
    );
}

/**
 * Свойства многострочного поля: стандартные свойства `textarea`
 */
export interface TextAreaProps
    extends FieldMessages, Omit<ComponentProps<'textarea'>, 'children' | 'aria-invalid'> {}

/**
 * Подписанное многострочное поле: связывает подпись, подсказку и ошибку с элементом ввода
 *
 * @param props - подпись, подсказка, ошибка и свойства `textarea`
 * @returns поле формы
 */
export function TextArea({
    label,
    hint,
    error,
    wrapperClassName,
    id,
    className,
    ...props
}: TextAreaProps) {
    const ids = useFieldIds(id);

    return (
        <FieldShell
            label={label}
            hint={hint}
            error={error}
            wrapperClassName={wrapperClassName}
            ids={ids}
        >
            <textarea
                {...props}
                {...controlAria(ids, { hint, error })}
                className={classNames('field__control', className)}
            />
        </FieldShell>
    );
}
