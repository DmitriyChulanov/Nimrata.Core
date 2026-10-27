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
    /** Сохраняемые значения параметров */
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
        params: JSON.stringify(input.params ?? {}),
    });
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
