import type { ChangeResult, DataController } from '../data/DataController';

/**
 * Код отказа сервера: второй объект singleton-типа у того же родителя и владельца
 */
export const SINGLETON_EXISTS = 'singleton_exists';

/**
 * Перезагружает данные; при неудаче возвращает причину
 */
async function reload(data: DataController): Promise<ChangeResult> {
    await data.load();
    const { status, error } = data.getSnapshot();
    return status === 'ready'
        ? { ok: true }
        : { ok: false, error: error ?? 'Не удалось загрузить данные.' };
}

/**
 * Обвязка для `ensureStart` расширения: создание стартовой структуры устойчиво к устаревшим
 * данным и гонке с другой вкладкой.
 *
 * - Если модель помечена «нужна перезагрузка», данные сначала загружаются заново.
 * - Отказ `singleton_exists` значит «объект уже есть»: данные перезагружаются, результат успешный.
 * - Прочий 409 без кода (расхождение «было») — данные перезагружаются и попытка повторяется один раз.
 * - Остальные отказы возвращаются как есть.
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
    if (data.getSnapshot().needsReload) {
        const fresh = await reload(data);
        if (!fresh.ok) return fresh;
    }

    let result = await attempt();
    if (!result.ok && result.status === 409 && !result.code) {
        const fresh = await reload(data);
        if (!fresh.ok) return fresh;
        result = await attempt();
    }
    if (!result.ok && result.code === SINGLETON_EXISTS) return reload(data);
    return result;
}
