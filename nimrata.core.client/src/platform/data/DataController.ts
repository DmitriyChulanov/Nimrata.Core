import { ApiError } from '@platform/api/apiClient';

import type { Operation } from './undoHistory';
import { applyOperations, createUndoHistory, invertOperations, touchedIds } from './undoHistory';
import { uuid7 } from './uuid7';

import type { ApiClient } from '@platform/api/apiClient';
import type {
    ActionDefinition,
    ActionPlacement,
    CommandDefinition,
    TypeDefinition,
} from '@platform/types/types';

/**
 * Объект в дереве: значения свойств лежат в `properties`, отсутствующее значение — нет ключа
 */
export interface DataObject {
    id: string;
    /** Идентификатор типа объекта */
    type: string;
    parent: string | null;
    order: number;
    properties: Record<string, unknown>;
}

/**
 * Состояние загрузки модели данных
 */
export type DataStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Состояние модели для подписчиков UI (неизменяемый снимок)
 */
export interface DataSnapshot {
    /** Состояние загрузки */
    status: DataStatus;
    /** Версия модели: растёт при каждом изменении (удобно для `useSyncExternalStore`) */
    version: number;
    /** Причина последней ошибки загрузки или отказа сервера; `null`, если всё в порядке */
    error: string | null;
    /** Данные разошлись с сервером: нужно вызвать `reload()` */
    needsReload: boolean;
}

/**
 * Результат изменения: успех либо причина отказа, пригодная для показа пользователю
 */
export type ChangeResult = { ok: true } | ChangeFailure;
/**
 * Отказ изменения; при отказе сервера несёт его HTTP-код и машинный код ответа (если они были)
 */
export interface ChangeFailure {
    ok: false;
    error: string;
    /** HTTP-код отказа сервера */
    status?: number;
    /** Машинный код отказа (`singleton_exists`, `extension_disabled`) */
    code?: string;
}
/**
 * Результат создания объекта: идентификатор нового объекта либо причина отказа
 */
export type CreateResult = { ok: true; id: string } | ChangeFailure;

/**
 * Данные создаваемого объекта
 */
export interface CreateInput {
    type: string;
    /** Родитель; `null` или отсутствие — корень */
    parent?: string | null;
    /** Порядок среди соседей; без него объект добавляется последним */
    order?: number;
    /** Начальные значения свойств */
    properties?: Record<string, unknown>;
}

/**
 * Новое положение перемещаемого объекта
 */
export interface MoveInput {
    /** Новый родитель; `null` — корень; отсутствие — не менять */
    parent?: string | null;
    /** Новый порядок среди соседей; отсутствие — не менять */
    order?: number;
}

/**
 * Параметры выполнения операции
 */
export interface OperationOptions {
    /**
     * `false` — не запускать хуки (внутренние операции: повторы, Undo).
     * По умолчанию хуки запускаются
     */
    hooks?: boolean;
}

/**
 * Операции внутри одного набора изменений. Применяются к модели сразу и синхронно;
 * любой отказ отменяет весь набор. Внутри хуков и обработчиков действий пользоваться
 * только ими, а не методами `DataController` (иначе очередь изменений зависнет)
 */
export interface ChangeScope {
    create(input: CreateInput): CreateResult;
    setProperty(id: string, property: string, value: unknown): ChangeResult;
    move(id: string, to: MoveInput): ChangeResult;
    remove(id: string): ChangeResult;
}

/**
 * Операция, к которой подключается хук
 */
export type HookOperation = 'create' | 'setProperty' | 'move' | 'remove';
/**
 * Момент срабатывания хука: до операции или после неё
 */
export type HookPhase = 'before' | 'after';

/**
 * Контекст хука
 */
export interface HookContext {
    /** Выполняемая операция */
    operation: HookOperation;
    /** Момент срабатывания хука */
    phase: HookPhase;
    /**
     * Объект операции: «до» создания — черновик (ещё не в модели), «после» удаления —
     * снимок удалённого корня поддерева. Менять его не нужно: правки идут через `tx`
     */
    object: DataObject;
    /** `setProperty`: свойство, прежнее и новое значения (`null` — значения нет) */
    property?: string;
    oldValue?: unknown;
    newValue?: unknown;
    /** `move`: прежнее и новое положение */
    from?: { parent: string | null; order: number };
    to?: { parent: string | null; order: number };
    /** Тот же набор изменений, что и у исходного действия пользователя */
    tx: ChangeScope;
}

/**
 * Результат хука «до»: `{ cancel: сообщение }` отменяет операцию (и весь набор)
 */
export type HookResult = { cancel: string } | void;
/**
 * Обработчик хука
 */
export type HookHandler = (context: HookContext) => HookResult;

/**
 * Контекст обработчика действия
 */
export interface ActionContext {
    /** Снимок объекта-цели на момент запуска */
    object: DataObject;
    /** Значения параметров, собранные диалогом */
    params: Record<string, unknown>;
    /** Набор изменений действия: всё, что обработчик делает через него, — один набор */
    tx: ChangeScope;
}

/**
 * Обработчик действия; может быть асинхронным
 */
export type ActionHandler = (context: ActionContext) => void | Promise<void>;

/**
 * Параметры регистрации действия
 */
export interface ActionRegistrationOptions {
    /** Условие доступности: действие показывается и запускается только для объектов, где оно истинно */
    available?: (object: DataObject) => boolean;
}

/**
 * Контекст обработчика команды
 */
export interface CommandContext {
    /** Значения параметров: собранные диалогом или сохранённые пользовательской командой */
    params: Record<string, unknown>;
    /** Набор изменений команды: всё, что обработчик делает через него, — один набор */
    tx: ChangeScope;
}

/**
 * Обработчик команды; может быть асинхронным
 */
export type CommandHandler = (context: CommandContext) => void | Promise<void>;

/**
 * Параметры регистрации команды
 */
export interface CommandRegistrationOptions {
    /** Условие доступности: команда показывается на панели и запускается, только пока оно истинно */
    available?: () => boolean;
}

/**
 * Параметры контроллера данных
 */
export interface DataControllerOptions {
    /** API-клиент для загрузки данных и отправки наборов изменений */
    api: ApiClient;
    /** Генератор идентификаторов новых объектов (по умолчанию UUIDv7) */
    newId?: () => string;
}

/**
 * Контроллер данных: модель типов и объектов, изменения, хуки, действия и отмена
 */
export interface DataController {
    /** Загружает типы и объекты пользователя, заменяя модель */
    load(): Promise<void>;
    /** Текущий снимок состояния модели */
    getSnapshot(): DataSnapshot;
    /** Подписка на изменения модели; возвращает функцию отписки */
    subscribe(listener: () => void): () => void;
    /** Тип по идентификатору */
    getType(id: string): TypeDefinition | undefined;
    /** Все загруженные типы */
    getTypes(): TypeDefinition[];
    getObject(id: string): DataObject | undefined;
    /** Потомки родителя по возрастанию порядка; `null` — корневые объекты */
    getChildren(parent: string | null): DataObject[];
    /**
     * Порядок для вставки на позицию `index` среди потомков `parent`
     * (объект `exclude` — перемещаемый, в соседи не входит)
     */
    orderAt(parent: string | null, index: number, exclude?: string): number;
    /** Создаёт объект (одно действие — один набор изменений) */
    create(input: CreateInput, options?: OperationOptions): Promise<CreateResult>;
    /** Меняет свойство; `null` удаляет значение */
    setProperty(
        id: string,
        property: string,
        value: unknown,
        options?: OperationOptions,
    ): Promise<ChangeResult>;
    move(id: string, to: MoveInput, options?: OperationOptions): Promise<ChangeResult>;
    /** Удаляет объект вместе с потомками одним набором */
    remove(id: string, options?: OperationOptions): Promise<ChangeResult>;
    /** Отменяет последнее действие (обратным набором, без хуков); при отказе сервера стек не меняется */
    undo(): Promise<ChangeResult>;
    /** Повторяет последнее отменённое действие (без хуков) */
    redo(): Promise<ChangeResult>;
    canUndo(): boolean;
    canRedo(): boolean;
    /**
     * Выполняет произвольную последовательность операций одним набором изменений:
     * сбой любой операции или исключение отменяет весь набор
     */
    perform(
        run: (tx: ChangeScope) => void | Promise<void>,
        options?: OperationOptions,
    ): Promise<ChangeResult>;
    /**
     * Регистрирует хук операции для объектов типа `type` (`'*'` — любой тип).
     * Хуки одного вида вызываются в порядке регистрации. Возвращает функцию отписки
     */
    registerHook(
        type: string,
        operation: HookOperation,
        phase: HookPhase,
        handler: HookHandler,
    ): () => void;
    /** Привязывает обработчик к действию `actionId` типа `typeId`. Возвращает функцию отписки */
    registerAction(
        typeId: string,
        actionId: string,
        handler: ActionHandler,
        options?: ActionRegistrationOptions,
    ): () => void;
    /**
     * Действия объекта, у которых есть обработчик; с `placement` — только показываемые
     * в этом месте. Действие без обработчика не возвращается
     */
    getActions(objectId: string, placement?: ActionPlacement): ActionDefinition[];
    /**
     * Привязывает обработчик к команде расширения `id` (описана в `commands` манифеста).
     * Повторная регистрация того же `id` заменяет обработчик. Возвращает функцию отписки
     */
    registerCommand(
        id: string,
        handler: CommandHandler,
        options?: CommandRegistrationOptions,
    ): () => void;
    /** Есть ли у команды обработчик и выполняется ли её условие доступности */
    isCommandAvailable(id: string): boolean;
    /**
     * Запускает команду одним набором изменений; проверяет доступность и обязательные параметры
     * по описанию команды. Отказ и исключение обработчика возвращаются причиной
     */
    runCommand(
        command: Pick<CommandDefinition, 'id' | 'parameters'>,
        params?: Record<string, unknown>,
        options?: OperationOptions,
    ): Promise<ChangeResult>;
    /** Запускает действие над объектом-целью одним набором; проверяет обязательные параметры */
    runAction(
        objectId: string,
        actionId: string,
        params?: Record<string, unknown>,
        options?: OperationOptions,
    ): Promise<ChangeResult>;
}

/**
 * Текст причины из произвольной ошибки
 *
 * @param error - пойманное исключение
 * @returns сообщение ошибки или строковое представление значения
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Предел вложенности хуков: защита от бесконечной рекурсии
 */
const MAX_HOOK_DEPTH = 16;

/**
 * Набор изменений в процессе применения
 */
interface Scope {
    /** Операции набора в порядке выполнения */
    operations: Operation[];
    /** Состояние затронутых объектов до первого изменения (для отката); `undefined` — не было */
    before: Map<string, DataObject | undefined>;
    /** Запускать ли хуки в этом наборе */
    hooks: boolean;
    /** Текущая вложенность хуков */
    depth: number;
    /** Первая причина отказа: набор будет отменён */
    error: string | null;
}

/**
 * Зарегистрированный хук
 */
interface HookEntry {
    type: string;
    operation: HookOperation;
    phase: HookPhase;
    /** Обработчик хука */
    handler: HookHandler;
}

/**
 * Пустой ли параметр действия
 *
 * @param value - значение параметра
 * @returns `true` для `undefined`, `null` и пустой строки
 */
function isEmptyParam(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

/**
 * Создаёт контроллер данных
 *
 * @param options - API-клиент и генератор идентификаторов
 * @returns контроллер с пустой моделью; данные загружает `load`
 */
export function createDataController(options: DataControllerOptions): DataController {
    const { api } = options;

    let types = new Map<string, TypeDefinition>();
    let objects = new Map<string, DataObject>();
    let snapshot: DataSnapshot = { status: 'idle', version: 0, error: null, needsReload: false };
    const listeners = new Set<() => void>();
    const hookEntries: HookEntry[] = [];
    const actionHandlers = new Map<
        string,
        { handler: ActionHandler; options?: ActionRegistrationOptions }
    >();

    const commandHandlers = new Map<
        string,
        { handler: CommandHandler; options?: CommandRegistrationOptions }
    >();

    // Индекс «родитель → потомки по порядку»: строится по требованию, сбрасывается при любом
    // изменении модели (в том числе внутри набора, между его операциями)
    let childrenIndex: Map<string | null, DataObject[]> | null = null;

    function publish(patch: Partial<DataSnapshot>, model = true) {
        snapshot = { ...snapshot, ...patch, version: snapshot.version + (model ? 1 : 0) };
        childrenIndex = null;
        for (const listener of [...listeners]) listener();
    }

    function putObject(object: DataObject) {
        objects.set(object.id, object);
        childrenIndex = null;
    }

    function dropObject(id: string) {
        objects.delete(id);
        childrenIndex = null;
    }

    function getChildren(parent: string | null, exclude?: string): DataObject[] {
        if (!childrenIndex) {
            const index = new Map<string | null, DataObject[]>();
            for (const o of objects.values()) {
                const list = index.get(o.parent);
                if (list) list.push(o);
                else index.set(o.parent, [o]);
            }
            for (const list of index.values()) {
                list.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
            }
            childrenIndex = index;
        }
        const list = childrenIndex.get(parent) ?? [];
        return exclude === undefined ? [...list] : list.filter((o) => o.id !== exclude);
    }

    const newId = options.newId ?? uuid7;
    const history = createUndoHistory();
    // Наборы выполняются строго по очереди, чтобы откат одного не затирал соседние
    let queue: Promise<unknown> = Promise.resolve();

    function descendantsFirst(id: string): string[] {
        const result: string[] = [];
        for (const child of getChildren(id)) result.push(...descendantsFirst(child.id));
        result.push(id);
        return result;
    }

    function snapshotOf(object: DataObject): DataObject {
        return { ...object, properties: { ...object.properties } };
    }

    function touch(scope: Scope, id: string) {
        if (scope.before.has(id)) return;
        const o = objects.get(id);
        scope.before.set(id, o && snapshotOf(o));
    }

    function rollback(scope: Scope) {
        for (const [id, o] of scope.before) {
            if (o) putObject(o);
            else dropObject(id);
        }
    }

    function refuse(scope: Scope, error: string): { ok: false; error: string } {
        scope.error ??= error;
        return { ok: false, error };
    }

    /**
     * Запускает хуки; для фазы «до» возвращает сообщение отмены, если хук отказал
     */
    function runHooks(
        scope: Scope,
        tx: ChangeScope,
        operation: HookOperation,
        phase: HookPhase,
        base: Omit<HookContext, 'operation' | 'phase' | 'tx'>,
    ): string | null {
        if (!scope.hooks) return null;
        const matching = hookEntries.filter(
            (h) =>
                h.operation === operation &&
                h.phase === phase &&
                (h.type === '*' || h.type === base.object.type),
        );
        if (matching.length === 0) return null;
        if (scope.depth >= MAX_HOOK_DEPTH) return 'Слишком глубокая вложенность хуков.';
        scope.depth++;
        try {
            for (const entry of matching) {
                const result = entry.handler({ ...base, operation, phase, tx });
                if (phase === 'before' && result && typeof result.cancel === 'string') {
                    return result.cancel;
                }
                // Вложенная операция хука отказала — набор уже помечен ошибкой
                if (scope.error) return scope.error;
            }
            return null;
        } catch (error) {
            return errorMessage(error);
        } finally {
            scope.depth--;
        }
    }

    function makeScope(hooks: boolean): { scope: Scope; tx: ChangeScope } {
        const scope: Scope = { operations: [], before: new Map(), hooks, depth: 0, error: null };

        const tx: ChangeScope = {
            create(input) {
                const type = types.get(input.type);
                if (!type) return refuse(scope, `Тип "${input.type}" неизвестен.`);
                const parent = input.parent ?? null;
                if (parent !== null && !objects.has(parent)) {
                    return refuse(scope, 'Родитель не найден.');
                }
                const id = newId();
                const siblings = getChildren(parent);
                const lastSibling = siblings.at(-1);
                const order = input.order ?? (lastSibling ? lastSibling.order + 1 : 0);
                // Значения по умолчанию из определения типа; заданные явно приоритетнее
                const properties: Record<string, unknown> = {};
                for (const p of type.properties ?? []) {
                    if (p.default !== undefined && p.default !== null) properties[p.id] = p.default;
                }
                Object.assign(properties, input.properties);
                const object: DataObject = { id, type: input.type, parent, order, properties };

                const cancelled = runHooks(scope, tx, 'create', 'before', { object });
                if (cancelled !== null) return refuse(scope, cancelled);

                touch(scope, id);
                putObject(object);
                scope.operations.push({
                    op: 'create',
                    id,
                    type: input.type,
                    parent,
                    order,
                    properties,
                });

                const failed = runHooks(scope, tx, 'create', 'after', {
                    object: snapshotOf(object),
                });
                return failed !== null ? refuse(scope, failed) : { ok: true, id };
            },

            setProperty(id, property, value) {
                const object = objects.get(id);
                if (!object) return refuse(scope, 'Объект не найден.');
                const oldValue = object.properties[property] ?? null;
                const newValue = value ?? null;
                const context = { object: snapshotOf(object), property, oldValue, newValue };

                const cancelled = runHooks(scope, tx, 'setProperty', 'before', context);
                if (cancelled !== null) return refuse(scope, cancelled);

                // Хук «до» мог изменить объект: берём актуальную версию
                const current = objects.get(id);
                if (!current) return refuse(scope, 'Объект не найден.');
                touch(scope, id);
                const properties = { ...current.properties };
                if (newValue === null) delete properties[property];
                else properties[property] = newValue;
                putObject({ ...current, properties });
                scope.operations.push({
                    op: 'update',
                    id,
                    changes: { [property]: { old: oldValue, new: newValue } },
                });

                const failed = runHooks(scope, tx, 'setProperty', 'after', {
                    ...context,
                    object: snapshotOf(objects.get(id) ?? current),
                });
                return failed !== null ? refuse(scope, failed) : { ok: true };
            },

            move(id, to) {
                const object = objects.get(id);
                if (!object) return refuse(scope, 'Объект не найден.');
                const parent = to.parent === undefined ? object.parent : to.parent;
                if (parent !== null) {
                    if (!objects.has(parent)) return refuse(scope, 'Родитель не найден.');
                    for (
                        let p: string | null = parent;
                        p !== null;
                        p = objects.get(p)?.parent ?? null
                    ) {
                        if (p === id) {
                            return refuse(
                                scope,
                                'Нельзя переместить объект в самого себя или в потомка.',
                            );
                        }
                    }
                }
                const order = to.order ?? object.order;
                if (parent === object.parent && order === object.order) {
                    return refuse(scope, 'Перемещение ничего не меняет.');
                }
                const from = { parent: object.parent, order: object.order };
                const target = { parent, order };
                const context = { object: snapshotOf(object), from, to: target };

                const cancelled = runHooks(scope, tx, 'move', 'before', context);
                if (cancelled !== null) return refuse(scope, cancelled);

                const current = objects.get(id);
                if (!current) return refuse(scope, 'Объект не найден.');
                const operation: Extract<Operation, { op: 'move' }> = { op: 'move', id };
                if (parent !== from.parent) operation.parent = { old: from.parent, new: parent };
                if (order !== from.order) operation.order = { old: from.order, new: order };
                touch(scope, id);
                putObject({ ...current, parent, order });
                scope.operations.push(operation);

                const failed = runHooks(scope, tx, 'move', 'after', {
                    ...context,
                    object: snapshotOf(objects.get(id) ?? current),
                });
                return failed !== null ? refuse(scope, failed) : { ok: true };
            },

            remove(id) {
                const object = objects.get(id);
                if (!object) return refuse(scope, 'Объект не найден.');
                const removed = snapshotOf(object);

                const cancelled = runHooks(scope, tx, 'remove', 'before', { object: removed });
                if (cancelled !== null) return refuse(scope, cancelled);

                if (!objects.has(id)) return refuse(scope, 'Объект не найден.');
                for (const x of descendantsFirst(id)) {
                    touch(scope, x);
                    dropObject(x);
                    scope.operations.push({ op: 'delete', id: x });
                }

                const failed = runHooks(scope, tx, 'remove', 'after', { object: removed });
                return failed !== null ? refuse(scope, failed) : { ok: true };
            },
        };
        return { scope, tx };
    }

    /**
     * Выполняет набор: локально применяет операции, отправляет их на сервер одним запросом;
     * при отказе (в том числе вложенной операции или сервера) возвращает модель как была
     */
    function execute(
        run: (tx: ChangeScope, scope: Scope) => void | Promise<void>,
        opts: OperationOptions | undefined,
    ): Promise<ChangeResult> {
        const step = async (): Promise<ChangeResult> => {
            if (snapshot.needsReload) {
                return { ok: false, error: 'Данные разошлись с сервером: перезагрузите данные.' };
            }
            const { scope, tx } = makeScope(opts?.hooks !== false);
            try {
                await run(tx, scope);
            } catch (error) {
                scope.error ??= errorMessage(error);
            }
            if (scope.error !== null) {
                const touched = scope.before.size > 0;
                rollback(scope);
                if (touched) publish({});
                return { ok: false, error: scope.error };
            }
            if (scope.operations.length === 0) return { ok: true };

            publish({ error: null });
            try {
                await api.post('changesets', { operations: scope.operations });
                history.record({
                    forward: scope.operations,
                    inverse: invertOperations(scope.operations, scope.before),
                });
                publish({}, false);
                return { ok: true };
            } catch (error) {
                rollback(scope);
                publish({
                    error: errorMessage(error),
                    needsReload: error instanceof ApiError && error.status === 409,
                });
                return error instanceof ApiError
                    ? { ok: false, error: error.message, status: error.status, code: error.code }
                    : { ok: false, error: errorMessage(error) };
            }
        };
        const result = queue.then(step);
        queue = result;
        return result;
    }

    /**
     * Отмена и повтор: применяют сохранённый набор напрямую к модели, минуя `makeScope`,
     * поэтому хуки не вызываются; идут через ту же очередь. При отказе стек остаётся прежним
     */
    function replay(kind: 'undo' | 'redo'): Promise<ChangeResult> {
        const step = async (): Promise<ChangeResult> => {
            if (snapshot.needsReload) {
                return { ok: false, error: 'Данные разошлись с сервером: перезагрузите данные.' };
            }
            const entry = kind === 'undo' ? history.peekUndo() : history.peekRedo();
            if (!entry) {
                return {
                    ok: false,
                    error: kind === 'undo' ? 'Нечего отменять.' : 'Нечего повторять.',
                };
            }
            const operations = kind === 'undo' ? entry.inverse : entry.forward;
            const before = new Map(
                touchedIds(operations).map((id) => {
                    const o = objects.get(id);
                    return [id, o && snapshotOf(o)] as const;
                }),
            );
            applyOperations(objects, operations);
            publish({ error: null });
            const verb = kind === 'undo' ? 'отменить' : 'повторить';
            try {
                await api.post('changesets', { operations });
                if (kind === 'undo') history.markUndone();
                else history.markRedone();
                publish({}, false);
                return { ok: true };
            } catch (error) {
                for (const [id, o] of before) {
                    if (o) putObject(o);
                    else dropObject(id);
                }
                publish({ error: errorMessage(error) });
                return { ok: false, error: `Не удалось ${verb}: ${errorMessage(error)}` };
            }
        };
        const result = queue.then(step);
        queue = result;
        return result;
    }

    function registerHook(
        type: string,
        operation: HookOperation,
        phase: HookPhase,
        handler: HookHandler,
    ) {
        const entry: HookEntry = { type, operation, phase, handler };
        hookEntries.push(entry);
        return () => {
            const i = hookEntries.indexOf(entry);
            if (i >= 0) hookEntries.splice(i, 1);
        };
    }

    const actionKey = (typeId: string, actionId: string) => `${typeId}\u0000${actionId}`;

    function findAction(object: DataObject, actionId: string) {
        const definition = types.get(object.type)?.actions?.find((a) => a.id === actionId);
        const entry = actionHandlers.get(actionKey(object.type, actionId));
        if (!definition || !entry) return undefined;
        if (entry.options?.available && !entry.options.available(object)) return undefined;
        return { definition, handler: entry.handler };
    }

    return {
        async load() {
            publish({ status: 'loading', error: null }, false);
            try {
                const [loadedTypes, loadedObjects] = await Promise.all([
                    api.get<TypeDefinition[]>('types'),
                    api.get<DataObject[]>('objects'),
                ]);
                types = new Map(loadedTypes.map((t) => [t.id, t]));
                objects = new Map(loadedObjects.map((o) => [o.id, { ...o }]));
                history.clear();
                publish({ status: 'ready', error: null, needsReload: false });
            } catch (error) {
                publish({ status: 'error', error: errorMessage(error) }, false);
            }
        },
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getType: (id) => types.get(id),
        getTypes: () => [...types.values()],
        getObject: (id) => objects.get(id),
        getChildren: (parent) => getChildren(parent),
        orderAt(parent, index, exclude) {
            const siblings = getChildren(parent, exclude);
            const first = siblings[0];
            const last = siblings.at(-1);
            if (!first || !last) return 0;
            if (index <= 0) return first.order - 1;
            const before = siblings[index - 1];
            const after = siblings[index];
            if (!before || !after) return last.order + 1;
            return (before.order + after.order) / 2;
        },
        async create(input, opts) {
            let created: CreateResult = { ok: false, error: 'Объект не создан.' };
            const result = await execute((tx) => {
                created = tx.create(input);
            }, opts);
            return result.ok ? created : result;
        },
        setProperty: (id, property, value, opts) =>
            execute((tx) => void tx.setProperty(id, property, value), opts),
        move: (id, to, opts) => execute((tx) => void tx.move(id, to), opts),
        remove: (id, opts) => execute((tx) => void tx.remove(id), opts),
        undo: () => replay('undo'),
        redo: () => replay('redo'),
        canUndo: () => history.canUndo(),
        canRedo: () => history.canRedo(),
        perform: (run, opts) => execute((tx) => run(tx), opts),
        registerHook,
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
        runCommand(command, params = {}, opts) {
            const entry = commandHandlers.get(command.id);
            if (!entry || (entry.options?.available && !entry.options.available())) {
                return Promise.resolve({
                    ok: false,
                    error: `Команда "${command.id}" недоступна.`,
                });
            }
            for (const p of command.parameters ?? []) {
                if (p.required && isEmptyParam(params[p.id])) {
                    return Promise.resolve({
                        ok: false,
                        error: `Параметр «${p.name}» обязателен.`,
                    });
                }
            }
            return execute((tx) => entry.handler({ params, tx }), opts);
        },
        getActions(objectId, placement) {
            const object = objects.get(objectId);
            if (!object) return [];
            return (types.get(object.type)?.actions ?? []).filter(
                (a) =>
                    findAction(object, a.id) !== undefined &&
                    (placement === undefined || (a.placements ?? []).includes(placement)),
            );
        },
        runAction(objectId, actionId, params = {}, opts) {
            const object = objects.get(objectId);
            if (!object) return Promise.resolve({ ok: false, error: 'Объект не найден.' });
            const found = findAction(object, actionId);
            if (!found) {
                return Promise.resolve({
                    ok: false,
                    error: `У объекта нет действия "${actionId}" с обработчиком.`,
                });
            }
            for (const p of found.definition.parameters ?? []) {
                if (p.required && isEmptyParam(params[p.id])) {
                    return Promise.resolve({
                        ok: false,
                        error: `Параметр «${p.name}» обязателен.`,
                    });
                }
            }
            return execute(
                (tx) =>
                    found.handler({
                        object: snapshotOf(objects.get(objectId) ?? object),
                        params,
                        tx,
                    }),
                opts,
            );
        },
    };
}
