/**
 * Безопасный адрес для перехода: только http и https
 *
 * @param value - проверяемое значение (обычно свойство объекта)
 * @returns нормализованный адрес или `null`, если значение не строка или схема недопустима
 */
export function safeUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value.trim());
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}
