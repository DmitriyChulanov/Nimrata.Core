import type { SVGProps } from 'react';

import './Icon.css';
import { FALLBACK_ICON, ICON_REGISTRY, isIconName } from './registry';

/**
 * Размер иконки: соответствует токенам `--icon-sm`, `--icon-md`, `--icon-lg`
 */
export type IconSize = 'sm' | 'md' | 'lg';

/**
 * Имена, для которых уже выведено предупреждение: каждое неизвестное имя сообщается один раз
 */
const warnedNames = new Set<string>();

/**
 * Свойства иконки: стандартные свойства SVG без вложенных элементов
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'name'> {
    /** Имя из реестра иконок; пустое или неизвестное имя даёт запасную иконку */
    name?: string;
    /** Размер из шкалы токенов; по умолчанию основной */
    size?: IconSize;
}

/**
 * Иконка из реестра по имени: одноцветная, размер и штрих берутся из токенов
 *
 * @param props - имя, размер и свойства SVG
 * @returns SVG, скрытый от вспомогательных технологий, если не задан `aria-label`
 */
export function Icon({ name, size = 'md', className, ...props }: IconProps) {
    let resolved = FALLBACK_ICON;
    if (name !== undefined && name !== '') {
        if (isIconName(name)) {
            resolved = name;
        } else if (!warnedNames.has(name)) {
            warnedNames.add(name);
            console.warn(`Иконка «${name}» не найдена в реестре, показана запасная`);
        }
    }
    const Component = ICON_REGISTRY[resolved];
    const decorative = props['aria-label'] === undefined;
    const classes = ['icon', size === 'md' ? '' : `icon--${size}`, className]
        .filter(Boolean)
        .join(' ');

    return (
        <Component
            className={classes}
            aria-hidden={decorative ? 'true' : undefined}
            role={decorative ? undefined : 'img'}
            focusable="false"
            {...props}
        />
    );
}
