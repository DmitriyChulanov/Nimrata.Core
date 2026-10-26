import { classNames } from './classNames';
import './Checkbox.css';

import type { ComponentProps } from 'react';

/**
 * Свойства флажка: стандартные свойства `input` без типа
 */
export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'children'> {
    /** Подпись справа от флажка */
    label: string;
    /** Класс корневого элемента */
    wrapperClassName?: string;
}

/**
 * Флажок с подписью: клик по подписи переключает флажок
 *
 * @param props - подпись и свойства `input`
 * @returns подпись с флажком
 */
export function Checkbox({ label, wrapperClassName, ...props }: CheckboxProps) {
    return (
        <label className={classNames('checkbox', wrapperClassName)}>
            <input type="checkbox" {...props} />
            {label}
        </label>
    );
}
