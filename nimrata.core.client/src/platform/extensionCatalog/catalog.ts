import type { ApiClient } from '@platform/api/apiClient';
import type { CommandDefinition } from '@platform/types/types';

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
    /** Команды расширения из манифеста (ADR 0004); пусто, если команд нет */
    commands: CommandDefinition[];
}

/**
 * Проверяет, что значение — элемент каталога расширений
 *
 * @param value - проверяемое значение
 * @returns `true`, если есть строковые поля, признаки подключения и массив команд с `id`, `name`, `icon`
 */
function isExtensionInfo(value: unknown): value is ExtensionInfo {
    if (typeof value !== 'object' || value === null) return false;
    const item: Partial<Record<keyof ExtensionInfo, unknown>> = value;
    return (
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.description === 'string' &&
        typeof item.icon === 'string' &&
        typeof item.defaultEnabled === 'boolean' &&
        typeof item.connected === 'boolean' &&
        Array.isArray(item.commands) &&
        item.commands.every(
            (command: unknown) =>
                typeof command === 'object' &&
                command !== null &&
                'id' in command &&
                typeof command.id === 'string' &&
                'name' in command &&
                typeof command.name === 'string' &&
                'icon' in command &&
                typeof command.icon === 'string',
        )
    );
}

/**
 * Проверяет, что значение — каталог расширений (например, сохранённый в IndexedDB)
 *
 * @param value - проверяемое значение
 * @returns `true`, если это массив элементов каталога верной формы
 */
export function isExtensionCatalog(value: unknown): value is ExtensionInfo[] {
    return Array.isArray(value) && value.every(isExtensionInfo);
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
    return items.map(withCommands);
}

/**
 * Приводит элемент каталога к виду с обязательным списком команд
 *
 * @param item - элемент ответа сервера
 * @returns элемент, у которого `commands` всегда массив
 */
function withCommands(item: ExtensionInfo): ExtensionInfo {
    return { ...item, commands: Array.isArray(item.commands) ? item.commands : [] };
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
    return api
        .put<ExtensionInfo>(`extensions/${encodeURIComponent(id)}/connection`, { connected })
        .then(withCommands);
}
