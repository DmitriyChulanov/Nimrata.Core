import type { ChangeResult, DataController } from '../data/DataController';

/**
 * Перезагружает данные и проверяет статус загрузки
 *
 * @param data - контроллер данных
 * @returns успех либо причина, по которой данные не загрузились
 */
export async function reloadData(data: DataController): Promise<ChangeResult> {
    await data.load();
    const { status, error } = data.getSnapshot();
    return status === 'ready'
        ? { ok: true }
        : { ok: false, error: error ?? 'Не удалось загрузить данные.' };
}
