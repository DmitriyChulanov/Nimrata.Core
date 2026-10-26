import { Icon } from '@platform/icons/Icon';

import { classNames } from './classNames';
import './Button.css';

import type { ComponentProps } from 'react';
import type { IconSize } from '@platform/icons/Icon';

/**
 * Вид кнопки: `primary` — главное действие области, `secondary` — обычное,
 * `ghost` — без рамки, `danger` — необратимое действие
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Свойства кнопки: стандартные свойства `button`
 */
export interface ButtonProps extends ComponentProps<'button'> {
    /** Вид кнопки; по умолчанию обычная */
    variant?: ButtonVariant;
    /** Имя иконки реестра слева от подписи */
    icon?: string;
}

/**
 * Кнопка UI-кита; тип по умолчанию `button`, чтобы не отправлять форму случайно
 *
 * @param props - вид, иконка и свойства `button`
 * @returns кнопка с подписью и необязательной иконкой
 */
export function Button({
    variant = 'secondary',
    icon,
    type = 'button',
    className,
    children,
    ...props
}: ButtonProps) {
    return (
        <button type={type} className={classNames('btn', `btn--${variant}`, className)} {...props}>
            {icon !== undefined && <Icon name={icon} />}
            {children}
        </button>
    );
}

/**
 * Свойства кнопки-значка: подпись обязательна, так как видимого текста нет
 */
export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'aria-label'> {
    /** Имя иконки реестра */
    icon: string;
    /** Подпись для вспомогательных технологий и подсказки */
    label: string;
    /** Размер иконки; по умолчанию основной */
    iconSize?: IconSize;
}

/**
 * Квадратная кнопка с одной иконкой; по умолчанию без рамки
 *
 * @param props - иконка, подпись, вид и свойства `button`
 * @returns кнопка, доступная по подписи
 */
export function IconButton({
    icon,
    label,
    iconSize,
    variant = 'ghost',
    className,
    ...props
}: IconButtonProps) {
    return (
        <Button
            variant={variant}
            className={classNames('btn--icon', className)}
            aria-label={label}
            title={label}
            {...props}
        >
            <Icon name={icon} size={iconSize} />
        </Button>
    );
}
