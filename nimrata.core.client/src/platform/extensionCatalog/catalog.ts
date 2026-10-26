import type { ApiClient } from '@platform/api/apiClient';

/**
 * Расширение в каталоге сервера вместе с состоянием подключения вошедшего пользователя
 */
export interface ExtensionInfo {
    /** Идентификатор расширения (совпадает с `id` клиентского дескриптора) */
    id: string;
    /** Название для интерфейса */
    name: string;
    /** Краткое описание */
    description: string;
    /** Имя иконки из реестра иконок */
    icon: string;
    /** Подключено ли расширение, пока пользователь не менял настройку */
    defaultEnabled: boolean;
    /** Действующее состояние подключения пользователя */
    connected: boolean;
}

/**
 * Загружает каталог расширений (`GET /api/extensions`)
 *
 * @param api - API-клиент
 * @returns расширения по названию с состоянием подключения пользователя
 */
export async function fetchExtensionCatalog(api: ApiClient): Promise<ExtensionInfo[]> {
    const items = await api.get<ExtensionInfo[]>('extensions');
    if (!Array.isArray(items)) throw new Error('Сервер вернул неверный каталог расширений.');
    return items;
}

/**
 * Подключает или отключает расширение пользователя (`PUT /api/extensions/{id}/connection`)
 *
 * @param api - API-клиент
 * @param id - идентификатор расширения
 * @param connected - нужное состояние подключения
 * @returns обновлённый элемент каталога
 */
export function putExtensionConnection(
    api: ApiClient,
    id: string,
    connected: boolean,
): Promise<ExtensionInfo> {
    return api.put<ExtensionInfo>(`extensions/${encodeURIComponent(id)}/connection`, {
        connected,
    });
}
