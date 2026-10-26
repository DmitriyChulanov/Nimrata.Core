import { classNames } from './classNames';
import { controlAria, useFieldIds } from './fieldIds';
import { FieldShell } from './FieldShell';

import type { ComponentProps } from 'react';
import type { FieldMessages } from './FieldShell';

/**
 * Вариант выпадающего списка
 */
export interface SelectOption {
    /** Значение, попадающее в форму */
    value: string;
    /** Подпись варианта */
    label: string;
    /** Вариант недоступен для выбора */
    disabled?: boolean;
}

/**
 * Свойства выпадающего списка: стандартные свойства `select` без вложенных элементов
 */
export interface SelectProps
    extends FieldMessages, Omit<ComponentProps<'select'>, 'children' | 'aria-invalid'> {
    /** Варианты выбора */
    options: SelectOption[];
    /** Подпись пустого варианта; без неё пустого варианта нет */
    placeholder?: string;
}

/**
 * Подписанный выпадающий список: связывает подпись, подсказку и ошибку со списком
 *
 * @param props - подпись, варианты, подсказка, ошибка и свойства `select`
 * @returns поле формы
 */
export function Select({
    label,
    options,
    placeholder,
    hint,
    error,
    wrapperClassName,
    id,
    className,
    ...props
}: SelectProps) {
    const ids = useFieldIds(id);

    return (
        <FieldShell
            label={label}
            hint={hint}
            error={error}
            wrapperClassName={wrapperClassName}
            ids={ids}
        >
            <select
                {...props}
                {...controlAria(ids, { hint, error })}
                className={classNames('field__control', className)}
            >
                {placeholder !== undefined && <option value="">{placeholder}</option>}
                {options.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>
                        {option.label}
                    </option>
                ))}
            </select>
        </FieldShell>
    );
}
