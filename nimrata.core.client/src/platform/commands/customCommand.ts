import { createNode } from '@platform/extensionApi/changes';

import type { ChangeScope, DataController, DataObject } from '@platform/data/DataController';

/**
 * Платформенный скрытый тип «Пользовательская команда» (ADR 0004): сохранённый экземпляр команды
 * расширения. Свойства: `name` (подпись на панели), `extension` (владелец), `command`
 * (идентификатор команды в манифесте расширения), `params` (JSON-объект значений параметров строкой)
 */
export const CUSTOM_COMMAND = 'CustomCommand';

/**
 * Описание создаваемой пользовательской команды
 */
export interface CustomCommandInput {
    /** Подпись команды на панели */
    name: string;
    /** Идентификатор расширения-владельца */
    extension: string;
    /** Идентификатор команды-шаблона в манифесте расширения */
    command: string;
    /** Сохраняемые значения параметров; без них команда при запуске спрашивает параметры */
    params?: Record<string, unknown>;
}

/**
 * Создаёт пользовательскую команду корневым объектом платформенного типа; отказ — исключение,
 * отменяющее набор
 *
 * @param tx - область изменений действия или хука расширения
 * @param input - название, расширение, команда и значения параметров
 * @returns идентификатор созданного объекта
 */
export function createCustomCommand(tx: ChangeScope, input: CustomCommandInput): string {
    return createNode(tx, null, CUSTOM_COMMAND, {
        name: input.name,
        extension: input.extension,
        command: input.command,
        params: input.params === undefined ? '' : JSON.stringify(input.params),
    });
}

/**
 * Сохранены ли у команды значения параметров: без них (`params` пуст) запуск открывает диалог,
 * а с ними, даже пустыми, идёт без диалога
 *
 * @param object - объект типа `CustomCommand`
 * @returns `true`, если значения параметров сохранены
 */
export function hasSavedParams(object: DataObject): boolean {
    const raw = object.properties.params;
    return typeof raw === 'string' && raw !== '';
}

/**
 * Пользовательские команды расширения в порядке дерева
 *
 * @param data - контроллер данных
 * @param extensionId - идентификатор расширения-владельца
 * @returns объекты типа `CustomCommand` этого расширения
 */
export function customCommandsOf(data: DataController, extensionId: string): DataObject[] {
    return data
        .getChildren(null)
        .filter((o) => o.type === CUSTOM_COMMAND && o.properties.extension === extensionId);
}

/**
 * Подпись пользовательской команды
 *
 * @param object - объект типа `CustomCommand`
 * @returns название; пустая строка, если оно не задано
 */
export function readCustomName(object: DataObject): string {
    const name = object.properties.name;
    return typeof name === 'string' ? name : '';
}

/**
 * Сохранённые значения параметров пользовательской команды
 *
 * @param object - объект типа `CustomCommand`
 * @returns объект значений; пустой, если `params` отсутствует или повреждён
 */
export function readCustomParams(object: DataObject): Record<string, unknown> {
    const raw = object.properties.params;
    if (typeof raw !== 'string' || raw === '') return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}
