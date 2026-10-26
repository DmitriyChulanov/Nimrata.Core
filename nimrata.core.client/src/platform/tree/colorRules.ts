import type { ColorRule } from '@platform/types/types';

/**
 * Цвета манифеста, для которых в `ruleColors.css` заданы оттенки светлой и тёмной темы
 */
export const PALETTE_COLORS: ReadonlySet<string> = new Set([
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'gray',
]);

/**
 * Цвет первого правила, условие которого выполнено; без подходящего правила — `undefined`
 */
export function resolveRuleColor(
    rules: readonly ColorRule[] | undefined,
    properties: Readonly<Record<string, unknown>>,
): string | undefined {
    return rules?.find((rule) => properties[rule.property] === rule.equals)?.color;
}

/**
 * Как показать цвет: имя палитры (оттенок зависит от темы) или произвольное значение CSS напрямую
 */
export function colorPresentation(color: string | undefined): {
    paletteColor?: string;
    cssColor?: string;
} {
    if (color === undefined) return {};
    return PALETTE_COLORS.has(color) ? { paletteColor: color } : { cssColor: color };
}
