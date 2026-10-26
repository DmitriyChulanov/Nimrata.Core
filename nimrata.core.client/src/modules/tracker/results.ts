import type { HookResult } from '@platform';

/**
 * Результат операции набора изменений (`ok` или причина отказа)
 */
interface Outcome {
    ok: boolean;
    error?: string;
}

/**
 * Для кода внутри действий и `perform`: отказ операции превращается в исключение, отменяющее набор
 */
export function orThrow(result: Outcome): void {
    if (!result.ok) throw new Error(result.error);
}

/**
 * Для хуков: отказ операции превращается в отмену с причиной
 */
export function cancelIfFailed(result: Outcome): HookResult {
    if (!result.ok) return { cancel: result.error ?? 'Операция не выполнена.' };
}
