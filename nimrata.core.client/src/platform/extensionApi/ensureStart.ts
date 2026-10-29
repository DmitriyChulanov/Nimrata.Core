import { reloadData } from './reloadData';

import type { ChangeResult, DataController } from '../data/DataController';

/**
 * Код отказа сервера: второй объект singleton-типа у того же родителя и владельца
 */
export const SINGLETON_EXISTS = 'singleton_exists';

/**
 * Обвязка для `ensureStart` расширения: создание стартовой структуры устойчиво к гонке с другой вкладкой
 *
 * - Отказ `singleton_exists` значит «объект уже есть»: данные перезагружаются, результат успешный;
 * - Остальные отказы возвращаются как есть: «было» сервер не сверяет (LWW), поэтому повтора нет
 *
 * @param data - контроллер данных
 * @param attempt - попытка создания: смотрит в текущую модель, создаёт недостающее
 * (при полном наборе ничего не отправляет) и возвращает результат
 * @returns успех (в том числе «уже есть») либо причина отказа
 */
export async function ensureCreated(
    data: DataController,
    attempt: () => Promise<ChangeResult>,
): Promise<ChangeResult> {
    const result = await attempt();
    if (!result.ok && result.code === SINGLETON_EXISTS) return reloadData(data);
    return result;
}
