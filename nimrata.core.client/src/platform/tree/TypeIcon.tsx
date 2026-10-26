import { Icon } from '@platform/icons/Icon';

import { PALETTE_COLORS } from './colorRules';
import './ruleColors.css';

import type { IconSize, IconTone } from '@platform/icons/Icon';
import type { TypeDefinition } from '@platform/types/types';

/**
 * Свойства иконки типа
 */
export interface TypeIconProps {
    /** Тип объекта; без типа показывается запасная иконка */
    type: TypeDefinition | undefined;
    /** Размер иконки; по умолчанию основной */
    size?: IconSize;
}

/**
 * Иконка типа объекта: имя и цвет берутся из определения типа, неизвестный цвет игнорируется
 *
 * @param props - тип и размер
 * @returns иконка узла
 */
export function TypeIcon({ type, size }: TypeIconProps) {
    const color = type?.iconColor;
    const tone = color !== undefined && PALETTE_COLORS.has(color) ? (color as IconTone) : undefined;
    return <Icon name={type?.icon} size={size} tone={tone} />;
}
