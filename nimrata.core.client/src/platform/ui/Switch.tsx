import { classNames } from './classNames';
import './Switch.css';

import type { ComponentProps } from 'react';

/**
 * Свойства переключателя: стандартные свойства `input` без типа и роли
 */
export interface SwitchProps extends Omit<ComponentProps<'input'>, 'type' | 'role' | 'children'> {
    /** Подпись справа от переключателя */
    label: string;
    /** Класс корневого элемента */
    wrapperClassName?: string;
}

/**
 * Переключатель «вкл/выкл» с подписью: клик по подписи переключает; на клавиатуре — пробел
 *
 * @param props - подпись и свойства `input`
 * @returns подпись с переключателем
 */
export function Switch({ label, wrapperClassName, ...props }: SwitchProps) {
    return (
        <label className={classNames('switch', wrapperClassName)}>
            <input type="checkbox" role="switch" className="switch-input" {...props} />
            <span className="switch-track" aria-hidden="true" />
            {label}
        </label>
    );
}
