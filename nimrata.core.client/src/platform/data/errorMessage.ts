/**
 * Текст причины из произвольной ошибки
 *
 * @param error - пойманное исключение
 * @returns сообщение ошибки или строковое представление значения
 */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
