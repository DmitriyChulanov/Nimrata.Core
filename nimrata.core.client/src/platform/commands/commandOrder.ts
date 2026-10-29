import { createNode } from '@platform/extensionApi/changes';

import {
    CUSTOM_COMMAND,
    customCommandsOf,
    hasSavedParams,
    readCustomName,
    readCustomParams,
} from './customCommand';

import type { ChangeScope, DataController, DataObject } from '@platform/data/DataController';
import type { ExtensionInfo } from '@platform/extensionCatalog/catalog';
import type { CommandDefinition } from '@platform/types/types';

/**
 * Одна кнопка панели: команда манифеста или сохранённая пользовательская
 */
export interface CommandItem {
    /** Ключ элемента списка: `command.id` для команды манифеста, `custom:<id>` для объекта */
    key: string;
    /** Подпись кнопки */
    label: string;
    /** Всплывающее пояснение */
    description?: string;
    /** Имя иконки */
    icon: string;
    /** Команда манифеста, которую запускает кнопка */
    command: CommandDefinition;
    /** Объект `CustomCommand`; нет у ещё не «материализованной» команды манифеста */
    object?: DataObject;
    /** Сохранённые параметры (диалог не нужен); `undefined` — параметры спрашиваются */
    savedParams?: Record<string, unknown>;
}

/**
 * Положение вставки относительно кнопки-цели
 */
export type CommandDropPosition = 'before' | 'after';

/**
 * Кнопки блока расширения в порядке показа. Пока в блоке нет копий команд манифеста, сначала идут
 * команды манифеста, затем пользовательские по номеру. После первой перестановки копии (объекты
 * `CustomCommand` с `command` не-шаблона) заменяют оригиналы, идут по номеру, а команды манифеста
 * без копии (появившиеся позже) встают в конец
 *
 * @param data - контроллер данных
 * @param extension - расширение-владелец блока
 * @returns кнопки блока; пусто, если доступных команд нет
 */
export function commandItemsOf(data: DataController, extension: ExtensionInfo): CommandItem[] {
    const available = (command: CommandDefinition) => data.isCommandAvailable(command.id);
    const customs = customCommandsOf(data, extension.id);
    // Копия не-шаблона заменяет оригинал и тогда, когда сама недоступна: оригинал не возвращается
    const copied = new Set<string>();
    const numbered: CommandItem[] = [];
    for (const object of customs) {
        const command = extension.commands.find((c) => c.id === object.properties.command);
        if (!command) continue;
        if (!command.template) copied.add(command.id);
        if (!available(command)) continue;
        numbered.push({
            key: `custom:${object.id}`,
            label: readCustomName(object) || command.name,
            description: command.description,
            icon: command.icon,
            command,
            object,
            savedParams: hasSavedParams(object) ? readCustomParams(object) : undefined,
        });
    }
    const own: CommandItem[] = extension.commands
        .filter((command) => !command.template && !copied.has(command.id) && available(command))
        .map((command) => ({
            key: command.id,
            label: command.name,
            description: command.description,
            icon: command.icon,
            command,
        }));
    const hasCopies = numbered.some((item) => !item.command.template);
    return hasCopies ? [...numbered, ...own] : [...own, ...numbered];
}

/**
 * Порядок ключей после переноса кнопки
 *
 * @param keys - ключи кнопок блока в порядке показа
 * @param dragged - ключ переносимой кнопки
 * @param target - ключ кнопки, рядом с которой вставляем
 * @param position - вставка до или после цели
 * @returns новый порядок; `null`, если перенос ничего не меняет или ключи неизвестны
 */
export function planCommandOrder(
    keys: readonly string[],
    dragged: string,
    target: string,
    position: CommandDropPosition,
): string[] | null {
    if (dragged === target || !keys.includes(dragged) || !keys.includes(target)) return null;
    const rest = keys.filter((k) => k !== dragged);
    const index = rest.indexOf(target) + (position === 'after' ? 1 : 0);
    const next = [...rest.slice(0, index), dragged, ...rest.slice(index)];
    return next.every((k, i) => k === keys[i]) ? null : next;
}

/**
 * Записывает порядок блока в одну область изменений: команды манифеста без копии «материализуются»
 * в `CustomCommand` (без названия и параметров, подпись берётся из манифеста), остальным ставится
 * номер по позиции
 *
 * @param tx - область изменений
 * @param extensionId - расширение-владелец блока
 * @param items - кнопки блока в порядке показа
 * @param order - новый порядок ключей кнопок
 */
export function writeCommandOrder(
    tx: ChangeScope,
    extensionId: string,
    items: readonly CommandItem[],
    order: readonly string[],
): void {
    const byKey = new Map(items.map((item) => [item.key, item]));
    order.forEach((key, i) => {
        const item = byKey.get(key);
        if (!item) return;
        const number = i + 1;
        if (!item.object) {
            createNode(
                tx,
                null,
                CUSTOM_COMMAND,
                { name: '', extension: extensionId, command: item.command.id, params: '' },
                number,
            );
        } else if (item.object.number !== number) {
            const moved = tx.move(item.object.id, { number });
            if (!moved.ok) throw new Error(moved.error);
        }
    });
}
