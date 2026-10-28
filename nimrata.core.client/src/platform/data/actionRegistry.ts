import { objectLabel } from '@platform/objectQueries/objectQueries';

import { errorMessage } from './errorMessage';

import type { ObjectReader } from '@platform/objectQueries/objectQueries';
import type {
    ActionDefinition,
    ActionPlacement,
    CommandDefinition,
    PropertyDefinition,
} from '@platform/types/types';
import type {
    ActionContext,
    ActionHandler,
    ActionRegistrationOptions,
    ChangeResult,
    ChangeScope,
    CommandHandler,
    CommandRegistrationOptions,
    DataObject,
    GroupAction,
    OperationOptions,
} from './DataController';

/**
 * Исполнитель набора изменений: `DataController.execute` или заглушка в тестах. Шаг получает набор
 * и доступ к первой причине отказа (`error`), которую обработчики могли записать через хуки
 */
export type ActionExecutor = (
    run: (tx: ChangeScope, scope: { error: string | null }) => void | Promise<void>,
    options: OperationOptions | undefined,
) => Promise<ChangeResult>;

/**
 * Зависимости реестра
 */
export interface ActionRegistryOptions {
    /** Чтение Объектов и типов */
    reader: ObjectReader;
    /** Исполнение набора изменений */
    execute: ActionExecutor;
}

/**
 * Итог подготовки группового запуска: параметры для диалога либо причина недоступности
 */
export type GroupLaunch = { parameters: PropertyDefinition[] } | { unavailable: string };

/**
 * Реестр Действий и Команд: обработчики, доступность, параметры и запуск. Правила не знают о
 * сервере и Журнале; изменения делает переданный `execute`
 */
export interface ActionRegistry {
    registerAction(
        typeId: string,
        actionId: string,
        handler: ActionHandler,
        options?: ActionRegistrationOptions,
    ): () => void;
    registerCommand(
        id: string,
        handler: CommandHandler,
        options?: CommandRegistrationOptions,
    ): () => void;
    isCommandAvailable(id: string): boolean;
    /** Действия одного объекта: недоступные и без обработчика скрыты (частный случай группы) */
    getActions(objectId: string, placement?: ActionPlacement): ActionDefinition[];
    /** Параметры действия для одного объекта с вариантами `parameterValues` */
    getActionParameters(objectId: string, action: ActionDefinition): PropertyDefinition[];
    /** Общие действия группы; недоступное хотя бы одному объекту показано с причиной */
    getGroupActions(objectIds: readonly string[], placement?: ActionPlacement): GroupAction[];
    /** Общие параметры группы; `null`, если общих значений нет */
    getGroupActionParameters(
        objectIds: readonly string[],
        action: ActionDefinition,
    ): PropertyDefinition[] | null;
    /** Подготовка запуска по выделению: параметры для диалога либо причина недоступности */
    groupLaunch(objectIds: readonly string[], action: ActionDefinition): GroupLaunch;
    runAction(
        objectId: string,
        actionId: string,
        params?: Record<string, unknown>,
        options?: OperationOptions,
    ): Promise<ChangeResult>;
    runActionOnMany(
        objectIds: readonly string[],
        actionId: string,
        params?: Record<string, unknown>,
        options?: OperationOptions,
    ): Promise<ChangeResult>;
    runCommand(
        command: Pick<CommandDefinition, 'id' | 'parameters'>,
        params?: Record<string, unknown>,
        options?: OperationOptions,
    ): Promise<ChangeResult>;
    /** Сообщение о первом незаполненном обязательном параметре; иначе `undefined` */
    missingRequired(
        definitions: readonly { id: string; name: string; required?: boolean }[] | undefined,
        params: Record<string, unknown>,
    ): string | undefined;
}

/** Причина недоступности группового действия без общих значений параметров */
const NO_COMMON_VALUES = 'Нет общих значений параметров';

function isEmptyParam(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

function snapshotOf(object: DataObject): DataObject {
    return { ...object, properties: { ...object.properties } };
}

function missingRequired(
    definitions: readonly { id: string; name: string; required?: boolean }[] | undefined,
    params: Record<string, unknown>,
): string | undefined {
    const missing = (definitions ?? []).find((p) => p.required && isEmptyParam(params[p.id]));
    return missing && `Параметр «${missing.name}» обязателен.`;
}

/**
 * Создаёт реестр Действий и Команд
 *
 * @param options - чтение Объектов и исполнитель наборов изменений
 * @returns реестр с пустым набором обработчиков
 */
export function createActionRegistry({ reader, execute }: ActionRegistryOptions): ActionRegistry {
    const actionHandlers = new Map<
        string,
        { handler: ActionHandler; options?: ActionRegistrationOptions }
    >();
    const commandHandlers = new Map<
        string,
        { handler: CommandHandler; options?: CommandRegistrationOptions }
    >();

    const actionKey = (typeId: string, actionId: string) => `${typeId}\u0000${actionId}`;

    /** Действие, объявленное в типе объекта и имеющее обработчик; без проверки доступности */
    function declaredAction(object: DataObject, actionId: string) {
        const definition = reader.getType(object.type)?.actions?.find((a) => a.id === actionId);
        const entry = actionHandlers.get(actionKey(object.type, actionId));
        return definition && entry ? { definition, entry } : undefined;
    }

    function findAction(object: DataObject, actionId: string) {
        const declared = declaredAction(object, actionId);
        if (!declared) return undefined;
        const { definition, entry } = declared;
        if (entry.options?.available && !entry.options.available(object)) return undefined;
        return { definition, handler: entry.handler };
    }

    function actionParameters(objectId: string, action: ActionDefinition): PropertyDefinition[] {
        const object = reader.getObject(objectId);
        const providers = object
            ? actionHandlers.get(actionKey(object.type, action.id))?.options?.parameterValues
            : undefined;
        const result: PropertyDefinition[] = [];
        for (const parameter of action.parameters ?? []) {
            const provider = providers?.[parameter.id];
            if (!object || !provider) {
                result.push(parameter);
                continue;
            }
            const values = provider(snapshotOf(object));
            if (values.length > 0) result.push({ ...parameter, values });
        }
        return result;
    }

    function groupActionParameters(
        objectIds: readonly string[],
        action: ActionDefinition,
    ): PropertyDefinition[] | null {
        const perObject = objectIds.map((id) => actionParameters(id, action));
        const result: PropertyDefinition[] = [];
        for (const parameter of action.parameters ?? []) {
            const mine = perObject.map((list) => list.find((p) => p.id === parameter.id));
            // Параметр убран у объекта (пустой список вариантов): общих значений нет
            if (mine.some((p) => p === undefined)) return null;
            const [first, ...rest] = mine as PropertyDefinition[];
            if (parameter.kind !== 'enum') {
                result.push(parameter);
                continue;
            }
            const values = (first.values ?? []).filter((v) =>
                rest.every((p) => (p.values ?? []).some((x) => x.value === v.value)),
            );
            if (values.length === 0) return null;
            result.push({ ...first, values });
        }
        return result;
    }

    function getGroupActions(
        objectIds: readonly string[],
        placement?: ActionPlacement,
    ): GroupAction[] {
        const group = objectIds.map((id) => reader.getObject(id));
        const [first] = group;
        if (!first || group.some((o) => o === undefined)) return [];
        const members = group as DataObject[];
        const result: GroupAction[] = [];
        for (const action of reader.getType(first.type)?.actions ?? []) {
            const declared = members.map((o) => declaredAction(o, action.id));
            if (declared.some((d) => d === undefined)) continue;
            const inPlace = (d: (typeof declared)[number]) =>
                placement === undefined || (d?.definition.placements ?? []).includes(placement);
            if (!declared.every(inPlace)) continue;
            const blocked = members.find((o, i) => {
                const available = declared[i]?.entry.options?.available;
                return available !== undefined && !available(o);
            });
            // Одному объекту недоступное действие скрыто, группе — показано с причиной
            if (blocked && members.length === 1) continue;
            const unavailable = blocked
                ? `Недоступно для объекта «${objectLabel(reader, blocked)}»`
                : members.length > 1 && groupActionParameters(objectIds, action) === null
                  ? NO_COMMON_VALUES
                  : null;
            result.push({ action, unavailable });
        }
        return result;
    }

    /**
     * Запуск по выделению одним набором. Один объект — частный случай группы: без приставки с
     * именем объекта в причинах отказа
     */
    function runMany(
        objectIds: readonly string[],
        actionId: string,
        params: Record<string, unknown>,
        opts: OperationOptions | undefined,
    ): Promise<ChangeResult> {
        const prefixed = objectIds.length > 1;
        return execute(async (tx, scope) => {
            for (const id of objectIds) {
                const object = reader.getObject(id);
                if (!object) throw new Error('Объект не найден.');
                const label = prefixed ? `${objectLabel(reader, object)}: ` : '';
                const found = findAction(object, actionId);
                if (!found) {
                    throw new Error(`${label}у объекта нет действия "${actionId}" с обработчиком.`);
                }
                const missing = missingRequired(found.definition.parameters, params);
                if (missing) throw new Error(missing);
                const context: ActionContext = { object: snapshotOf(object), params, tx };
                try {
                    await found.handler(context);
                } catch (error) {
                    throw new Error(`${label}${errorMessage(error)}`, { cause: error });
                }
                if (scope.error !== null) {
                    scope.error = `${label}${scope.error}`;
                    return;
                }
            }
        }, opts);
    }

    return {
        registerAction(typeId, actionId, handler, options) {
            const key = actionKey(typeId, actionId);
            const entry = { handler, options };
            actionHandlers.set(key, entry);
            return () => {
                if (actionHandlers.get(key) === entry) actionHandlers.delete(key);
            };
        },
        registerCommand(id, handler, options) {
            const entry = { handler, options };
            commandHandlers.set(id, entry);
            return () => {
                if (commandHandlers.get(id) === entry) commandHandlers.delete(id);
            };
        },
        isCommandAvailable(id) {
            const entry = commandHandlers.get(id);
            return entry !== undefined && (entry.options?.available?.() ?? true);
        },
        getActions: (objectId, placement) =>
            getGroupActions([objectId], placement).map((g) => g.action),
        getActionParameters: actionParameters,
        getGroupActions,
        getGroupActionParameters: groupActionParameters,
        groupLaunch(objectIds, action) {
            const parameters =
                objectIds.length === 1
                    ? actionParameters(objectIds[0]!, action)
                    : groupActionParameters(objectIds, action);
            return parameters === null
                ? {
                      unavailable: `«${action.name}»: у выделенных объектов нет общих значений параметров.`,
                  }
                : { parameters };
        },
        runAction: (objectId, actionId, params = {}, opts) =>
            runMany([objectId], actionId, params, opts),
        runActionOnMany: (objectIds, actionId, params = {}, opts) =>
            runMany(objectIds, actionId, params, opts),
        runCommand(command, params = {}, opts) {
            const entry = commandHandlers.get(command.id);
            if (!entry || (entry.options?.available && !entry.options.available())) {
                return Promise.resolve({
                    ok: false,
                    error: `Команда "${command.id}" недоступна.`,
                });
            }
            const missing = missingRequired(command.parameters, params);
            if (missing) return Promise.resolve({ ok: false, error: missing });
            return execute((tx) => entry.handler({ params, tx }), opts);
        },
        missingRequired,
    };
}
