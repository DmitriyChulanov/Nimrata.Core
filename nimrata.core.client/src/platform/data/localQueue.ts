import type { ChangeResult } from './DataController';

/**
 * Итог шага локальной очереди: готовый результат либо ожидание итога набора на сервере
 */
export type StepResult = { result: ChangeResult } | { outcome: Promise<ChangeResult> };

/**
 * Ставит шаг в локальную очередь и возвращает итог действия
 */
export type EnqueueLocal = (step: () => Promise<StepResult>) => Promise<ChangeResult>;

/**
 * Локальная очередь действий контроллера: локальная часть наборов (хуки, обработчики, применение
 * к модели) выполняется строго по очереди, а ответа сервера следующее действие не ждёт
 *
 * @returns постановка шага в очередь; сбой шага не останавливает следующие
 */
export function createLocalQueue(): EnqueueLocal {
    let tail: Promise<unknown> = Promise.resolve();
    return async (step) => {
        const done = tail.then(step);
        tail = done.catch(() => undefined);
        const settled = await done;
        return 'result' in settled ? settled.result : settled.outcome;
    };
}
