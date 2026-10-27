import {
    CUSTOM_COMMAND,
    cancelIfFailed,
    createCustomCommand,
    customCommandsOf,
    orThrow,
    readCustomParams,
} from '@platform';

import { NOTE, NOTE_GROUP, OPEN_IN_TREE_COMMAND } from './constants';

import type { ChangeScope, DataController, DataObject, HookResult } from '@platform';

/**
 * Идентификатор расширения в манифесте (владелец пользовательских команд)
 */
const EXTENSION_ID = 'notes';

/**
 * Типы объектов, на которые можно создать команду быстрого доступа
 */
const TARGET_TYPES = [NOTE, NOTE_GROUP];

/**
 * Команды быстрого доступа расширения («Открыть в дереве»)
 */
function quickAccessCommands(data: DataController): DataObject[] {
    return customCommandsOf(data, EXTENSION_ID).filter(
        (o) => o.properties.command === OPEN_IN_TREE_COMMAND,
    );
}

/**
 * Команды, ссылающиеся на объект `targetId`
 */
function commandsOf(data: DataController, targetId: string): DataObject[] {
    return quickAccessCommands(data).filter((o) => readCustomParams(o).target === targetId);
}

/**
 * Название цели для команды: вычисляемое имя, а при его отсутствии — название
 */
function targetName(target: DataObject): string {
    for (const key of ['name', 'title']) {
        const value = target.properties[key];
        if (typeof value === 'string' && value !== '') return value;
    }
    return '';
}

/**
 * Идентификаторы объекта и всех его потомков
 */
function subtreeIds(data: DataController, id: string): Set<string> {
    const ids = new Set<string>();
    const walk = (current: string) => {
        ids.add(current);
        for (const child of data.getChildren(current)) walk(child.id);
    };
    walk(id);
    return ids;
}

/**
 * Удаляет команды быстрого доступа
 *
 * @param commands - команды для удаления
 * @param tx - область изменений, в которой выполняется удаление
 * @returns отмена изменений, если удалить команду не удалось; иначе ничего
 */
function removeCommands(commands: DataObject[], tx: ChangeScope): HookResult {
    for (const command of commands) {
        const failed = cancelIfFailed(tx.remove(command.id));
        if (failed) return failed;
    }
}

/**
 * Подключает команду «Открыть в дереве»: показывает цель в дереве, если она ещё существует
 *
 * @param data - контроллер данных
 * @param reveal - показ объекта в дереве
 * @returns функция отписки
 */
function registerOpenInTree(
    data: DataController,
    reveal: ((id: string) => void) | undefined,
): () => void {
    return data.registerCommand(OPEN_IN_TREE_COMMAND, ({ params }) => {
        const target = params.target;
        if (typeof target !== 'string' || !data.getObject(target)) {
            throw new Error('Объект быстрого доступа недоступен.');
        }
        reveal?.(target);
    });
}

/**
 * Подключает быстрый доступ: команду «Открыть в дереве», действия «Создать/Удалить команду для
 * быстрого доступа» у заметки и группы заметок и хуки, держащие команды в согласии с целями
 * (название при переименовании, удаление вместе с целью). Возвращает функцию отписки
 *
 * @param data - контроллер данных
 * @param reveal - показ объекта в дереве
 */
export function registerQuickAccess(
    data: DataController,
    reveal?: (id: string) => void,
): () => void {
    const disposers: (() => void)[] = [registerOpenInTree(data, reveal)];

    for (const type of TARGET_TYPES) {
        disposers.push(
            data.registerAction(
                type,
                'createQuickAccessCommand',
                ({ object, tx }) => {
                    // Повторное создание дубля не даёт
                    if (commandsOf(data, object.id).length > 0) return;
                    createCustomCommand(tx, {
                        name: targetName(object),
                        extension: EXTENSION_ID,
                        command: OPEN_IN_TREE_COMMAND,
                        params: { target: object.id },
                    });
                },
                { available: (object) => commandsOf(data, object.id).length === 0 },
            ),
            data.registerAction(
                type,
                'removeQuickAccessCommand',
                ({ object, tx }) => {
                    for (const command of commandsOf(data, object.id)) {
                        orThrow(tx.remove(command.id));
                    }
                },
                { available: (object) => commandsOf(data, object.id).length > 0 },
            ),
            // Название команды следует за названием цели в том же наборе изменений
            data.registerHook(type, 'setProperty', 'after', (ctx) => {
                if (ctx.property !== 'name') return;
                const name = typeof ctx.newValue === 'string' ? ctx.newValue : '';
                for (const command of commandsOf(data, ctx.object.id)) {
                    if (command.properties.name === name) continue;
                    const failed = cancelIfFailed(ctx.tx.setProperty(command.id, 'name', name));
                    if (failed) return failed;
                }
            }),
        );
    }

    // Удаление цели (в том числе группы с вложенными заметками) убирает команды всего поддерева
    disposers.push(
        data.registerHook('*', 'remove', 'before', (ctx) => {
            const commands = quickAccessCommands(data);
            if (commands.length === 0 || ctx.object.type === CUSTOM_COMMAND) return;
            const ids = subtreeIds(data, ctx.object.id);
            return removeCommands(
                commands.filter((c) => ids.has(String(readCustomParams(c).target))),
                ctx.tx,
            );
        }),
    );

    return () => disposers.forEach((dispose) => dispose());
}
