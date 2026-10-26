import { classNames } from './classNames';
import './Badge.css';

import type { ComponentProps } from 'react';

/**
 * Тон метки: нейтральный, акцентный или предупреждающий об опасности
 */
export type BadgeTone = 'neutral' | 'accent' | 'danger';

/**
 * Свойства метки: стандартные свойства `span`
 */
export interface BadgeProps extends ComponentProps<'span'> {
    /** Тон метки; по умолчанию нейтральный */
    tone?: BadgeTone;
}

/**
 * Метка: короткий статус или счётчик; смысл передаёт текст, а не только цвет
 *
 * @param props - тон и свойства `span`
 * @returns строчная метка
 */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
    return <span className={classNames('badge', `badge--${tone}`, className)} {...props} />;
}
