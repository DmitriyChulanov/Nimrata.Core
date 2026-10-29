import type { ChangeScope, HookResult } from '../data/DataController';

/**
 * Результат операции набора изменений (`ok` или причина отказа)
 */
interface Outcome {
    ok: boolean;
    error?: string;
}

/**
 * Для кода внутри действий и `perform`: отказ операции превращается в исключение, отменяющее набор
 *
 * @param result - результат операции области изменений
 */
export function orThrow(result: Outcome): void {
    if (!result.ok) throw new Error(result.error);
}

/**
 * Для хуков: отказ операции превращается в отмену с причиной
 *
 * @param result - результат операции области изменений
 * @returns отмена набора с причиной или ничего, если операция удалась
 */
export function cancelIfFailed(result: Outcome): HookResult {
    if (!result.ok) return { cancel: result.error ?? 'Операция не выполнена.' };
}

/**
 * Создаёт объект в области изменений; отказ превращается в исключение
 *
 * @param tx - область изменений
 * @param parent - идентификатор родителя или `null` для корня
 * @param type - тип объекта
 * @param properties - начальные свойства
 * @param number - номер среди соседей
 * @returns идентификатор созданного объекта
 */
export function createNode(
    tx: ChangeScope,
    parent: string | null,
    type: string,
    properties: Record<string, unknown> = {},
    number?: number,
): string {
    const result = tx.create({ type, parent, properties, number });
    orThrow(result);
    return result.ok ? result.id : '';
}
