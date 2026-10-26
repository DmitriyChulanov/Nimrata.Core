/**
 * Склеивает имена CSS-классов, пропуская пустые значения
 *
 * @param parts - имена классов, `false` и `undefined` пропускаются
 * @returns строка классов через пробел
 */
export function classNames(...parts: (string | false | null | undefined)[]): string {
    return parts.filter(Boolean).join(' ');
}
