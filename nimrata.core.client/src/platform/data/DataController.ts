import { createSyncEngine } from '@platform/sync/syncEngine';
import type { PushChannel } from '@platform/sync/syncEngine';

import { createActionRegistry } from './actionRegistry';
import { createDataStore } from './dataStore';
import { errorMessage } from './errorMessage';

import type { GroupLaunch } from './actionRegistry';
import type { DataStore, LocalEdit, StoreSnapshot } from './dataStore';
import type { HistoryEntry, Operation } from './undoHistory';
import { applyOperations, createUndoHistory, invertOperations, touchedIds } from './undoHistory';
import { uuid7 } from './uuid7';

import type { ApiClient } from '@platform/api/apiClient';
import type {
    ActionDefinition,
    ActionPlacement,
    CommandDefinition,
    EnumValue,
    PropertyDefinition,
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
    number: number;
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
    /**
     * Причина последней ошибки загрузки или сводное уведомление об отказе наборов (одно на
     * применение); `null`, если всё в порядке
     */
    error: string | null;
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
 * Итог одного набора в ответе пакетной записи `POST /api/changesets`
 */
export interface ChangesetResult {
    /** Идентификатор набора, присланный клиентом */
    id: string;
    /** Применён, повтор уже применённого или отклонён целиком */
    status: 'applied' | 'duplicate' | 'rejected';
    /** Курсор набора; у отклонённого отсутствует */
    seq?: number;
    /** Машинный код отказа (`singleton_exists`, `extension_disabled`) */
    code?: string;
    /** Причина отказа для пользователя */
    detail?: string;
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
    /** Номер среди соседей (целое ≥ 1); без него — максимальный номер соседей плюс 1 */
    number?: number;
    /** Начальные значения свойств */
    properties?: Record<string, unknown>;
}

/**
 * Новое положение перемещаемого объекта
 */
export interface MoveInput {
    /** Новый родитель; `null` — корень; отсутствие — не менять */
    parent?: string | null;
    /** Новый номер среди соседей (целое ≥ 1); отсутствие — не менять */
    number?: number;
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
    /**
     * `true` — итог ждёт ответа сервера (подтверждение или отказ набора). По умолчанию итог
     * разрешается, как только набор применён локально и встал в очередь (работает и без сети);
     * поздний отказ сервера откатывает набор с зависимыми и показывается сводным уведомлением
     */
    confirmed?: boolean;
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
    from?: { parent: string | null; number: number };
    to?: { parent: string | null; number: number };
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
 * Формирователь названия объекта типа; `undefined` или пустая строка — взять название по умолчанию
 * (`name`, затем название типа)
 */
export type TitleFormatter = (object: DataObject) => string | undefined;

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
    /**
     * Варианты параметров вида `enum`, зависящие от данных: по идентификатору параметра возвращают
     * значения для объекта-цели. Пустой список скрывает параметр в диалоге; `values` манифеста
     * остаются запасным описанием
     */
    parameterValues?: Record<string, (object: DataObject) => EnumValue[]>;
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
    /**
     * Сетевая часть: отправляет наборы очереди и пишет итоги и входящие изменения в хранилище.
     * По умолчанию — `createSyncEngine(api)` (пакеты с окном 200 мс, повтор при сбое сети)
     */
    transport?: ChangesetTransport;
}

/**
 * Вход хранилища для сетевой части (SyncEngine): очередь, итоги наборов, входящие изменения
 */
export type SyncPort = Pick<
    DataStore,
    | 'getSeq'
    | 'pending'
    | 'subscribePending'
    | 'subscribeSeq'
    | 'confirm'
    | 'reject'
    | 'applyRemote'
    | 'reset'
    | 'restoreQueue'
    | 'confirmedSnapshot'
>;

/**
 * Подключённая к хранилищу сетевая часть
 */
export interface SyncLink {
    /**
     * Полная загрузка (`GET /api/snapshot`) с переналожением очереди: неотправленные наборы
     * сначала уходят на сервер, снимок кладётся в хранилище через `SyncPort.reset`. Отказ — исключением
     */
    resync(): Promise<void>;
    /** Догон `GET /api/changes?since=<курсор>`; при ответе `resync` — полная загрузка */
    catchUp(): Promise<void>;
    /** Отправить неотправленные наборы сейчас, не дожидаясь окна и задержки повтора */
    kick(): void;
    /**
     * Подключает push-канал: после каждого соединения — догон и отправка очереди, сообщения
     * `changes` применяются, `resync` — полная загрузка. Возвращает отключение канала
     */
    connect(channel: PushChannel): () => void;
    /** Отключает сетевую часть: таймеры, push-соединение, поздние ответы игнорируются */
    dispose(): void;
    /** Состояние связи с сервером по итогу последнего запроса или события push-соединения */
    getState(): SyncState;
    /** Подписка на смену состояния связи; возвращает отписку */
    subscribeState(listener: () => void): () => void;
    /**
     * Подписка на полную загрузку по сигналу сервера (`resync` push или ответ догона): вызывается
     * после того, как снимок лёг в хранилище. Своя загрузка (`resync()`, `load`) не сообщается.
     * Возвращает отписку
     */
    onResync(listener: () => void): () => void;
}

/**
 * Связь с сервером: `online` — последний запрос удался (или запросов ещё не было), `offline` —
 * нет сети (запрос не дошёл, push-соединение оборвано), `error` — сервер ответил сбоем
 */
export type SyncConnection = 'online' | 'offline' | 'error';

/**
 * Состояние сетевой части для индикатора синхронизации
 */
export interface SyncState {
    /** Связь с сервером */
    connection: SyncConnection;
    /** Текст последней ошибки (`offline`, `error`); `null` — ошибки нет */
    error: string | null;
}

/**
 * Сетевая часть контроллера: подключается к хранилищу
 */
export type ChangesetTransport = (port: SyncPort) => SyncLink;

/**
 * Контроллер данных: модель типов и объектов, изменения, хуки, действия и отмена
 */
export interface DataController {
    /**
     * Загружает снимок сервера (`GET /api/snapshot`: курсор, типы, объекты) через сетевую часть:
     * подтверждённый слой заменяется, очередь неотправленных накладывается сверху
     */
    load(): Promise<void>;
    /**
     * Старт из кэша (офлайн): снимок кладётся в подтверждённый слой, очередь накладывается сверху,
     * модель сразу готова. Сеть не трогается — затем вызывают `catchUp`
     */
    startFromCache(snapshot: StoreSnapshot): void;
    /**
     * Догон изменений сервера после курсора (`GET /api/changes`); после него push применяется.
     * Без сети отказывает исключением, модель остаётся как была
     */
    catchUp(): Promise<void>;
    /** Отправить неотправленные наборы сейчас (сеть вернулась), не дожидаясь задержки повтора */
    kick(): void;
    /**
     * Освобождает контроллер (выход, истёкший вход): сетевая часть останавливается — таймеры,
     * push, поздние ответы; локальная модель остаётся читаемой
     */
    dispose(): void;
    /**
     * Подписка на сводные уведомления об отказах наборов (отказ сервера с каскадом, отбрасывание
     * при переналожении): итоги действий локальные, поэтому поздний отказ приходит только сюда
     * (и в `DataSnapshot.error`)
     */
    onNotice(listener: (message: string) => void): () => void;
    /** Текущий снимок состояния модели */
    getSnapshot(): DataSnapshot;
    /** Подписка на любые изменения модели; возвращает функцию отписки */
    subscribe(listener: () => void): () => void;
    /** Подписка на изменения одного объекта (в том числе появление и удаление) */
    subscribeObject(id: string, listener: () => void): () => void;
    /** Подписка на изменения детей родителя (`null` — корень): состав, порядок, сами дети */
    subscribeChildren(parent: string | null, listener: () => void): () => void;
    /** Тип по идентификатору */
    getType(id: string): TypeDefinition | undefined;
    /** Все загруженные типы */
    getTypes(): TypeDefinition[];
    getObject(id: string): DataObject | undefined;
    /**
     * Потомки родителя по возрастанию номера; `null` — корневые объекты. Ссылка на список
     * сохраняется, пока дети не изменились
     */
    getChildren(parent: string | null): readonly DataObject[];
    /** Вход хранилища для сетевой части: очередь, итоги наборов и входящие изменения */
    readonly sync: SyncPort;
    /** Подключает push-канал к сетевой части (SignalR в приложении); возвращает отключение */
    connectPush(channel: PushChannel): () => void;
    /** Состояние связи сетевой части с сервером (индикатор синхронизации) */
    getSyncState(): SyncState;
    /** Подписка на смену состояния связи; возвращает отписку */
    subscribeSyncState(listener: () => void): () => void;
    /**
     * Подписка на полную загрузку по сигналу сервера (например, расширение подключили в другой
     * вкладке): вызывается после того, как новый снимок лёг в модель. Возвращает отписку
     */
    onResync(listener: () => void): () => void;
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
    /**
     * Отменяет последнее действие (обратным набором, без хуков); при отказе сервера стек не меняется.
     * Если текущие значения уже не те, что ставило действие (их изменили в другом месте), отмена
     * отклоняется с уведомлением, а запись убирается из стека
     */
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
    /**
     * Задаёт способ формирования «Названия» объектов типа `typeId`. Название не хранится, а считается
     * при чтении; повторная регистрация того же типа заменяет формирователь. Возвращает функцию отписки
     */
    registerTitle(typeId: string, formatter: TitleFormatter): () => void;
    /** Название объекта от формирователя его типа; `undefined` — формирователя нет или он отказался */
    getTitle(object: DataObject): string | undefined;
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
     * Параметры действия для диалога: варианты `enum`, заданные через `parameterValues`, подставлены
     * по текущим данным, а параметры с пустым списком вариантов убраны
     */
    getActionParameters(objectId: string, action: ActionDefinition): PropertyDefinition[];
    /**
     * Действия, общие для группы объектов: объявлены и имеют обработчик у каждого объекта. Недоступное
     * (`available`) хотя бы одному объекту действие возвращается с причиной в `unavailable`, а у группы
     * из одного объекта такое действие, как в `getActions`, не возвращается. Описание берётся у первого объекта
     */
    getGroupActions(objectIds: readonly string[], placement?: ActionPlacement): GroupAction[];
    /**
     * Подготовка запуска действия по выделению: параметры для диалога (один объект — свои варианты,
     * группа — варианты `enum` как пересечение по всем объектам) либо причина недоступности, если
     * пересечение пусто. Правило «нет общих значений» живёт в реестре
     */
    groupLaunch(objectIds: readonly string[], action: ActionDefinition): GroupLaunch;
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
    /**
     * Запускает действие над каждым из объектов по очереди одним набором изменений: следующий объект
     * видит результат предыдущих, первый отказ отменяет весь запуск. Для группы отказ называет объект
     */
    runActionOnMany(
        objectIds: readonly string[],
        actionId: string,
        params?: Record<string, unknown>,
        options?: OperationOptions,
    ): Promise<ChangeResult>;
}

/**
 * Действие группы объектов и его доступность
 */
export interface GroupAction {
    /** Описание действия */
    action: ActionDefinition;
    /** Причина недоступности для группы; `null`, если действие можно запускать */
    unavailable: string | null;
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
 * Номер для нового объекта среди соседей: максимальный плюс 1, а в пустой коллекции — 1
 *
 * @param siblings - соседи нового объекта
 * @returns номер нового объекта
 */
function nextNumber(siblings: readonly DataObject[]): number {
    return siblings.reduce((max, o) => Math.max(max, o.number), 0) + 1;
}

/**
 * Совпадают ли значения свойства (значения из JSON сравниваются по содержимому)
 *
 * @param a - первое значение
 * @param b - второе значение
 * @returns `true`, если значения равны
 */
function sameValue(a: unknown, b: unknown): boolean {
    return a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Итог шага локальной очереди: готовый результат либо ожидание итога набора на сервере
 */
type StepResult = { result: ChangeResult } | { outcome: Promise<ChangeResult> };

/**
 * Создаёт контроллер данных
 *
 * @param options - API-клиент, генератор идентификаторов и сетевая часть
 * @returns контроллер с пустой моделью; данные загружает `load`
 */
export function createDataController(options: DataControllerOptions): DataController {
    const { api } = options;

    const store = createDataStore();
    let snapshot: DataSnapshot = { status: 'idle', version: 0, error: null };
    const listeners = new Set<() => void>();
    const hookEntries: HookEntry[] = [];
    const titleFormatters = new Map<string, TitleFormatter>();

    /**
     * Обновляет снимок состояния и уведомляет подписчиков
     *
     * @param patch - изменённые поля снимка
     * @param model - изменилась ли модель (растёт версия)
     */
    function publish(patch: Partial<DataSnapshot>, model = true) {
        snapshot = { ...snapshot, ...patch, version: snapshot.version + (model ? 1 : 0) };
        for (const listener of [...listeners]) listener();
    }
    store.subscribe(() => publish({}));
    store.onNotice((message) => publish({ error: message }, false));

    const getChildren = (parent: string | null) => store.getChildren(parent);

    const newId = options.newId ?? uuid7;
    const history = createUndoHistory();
    const link = (options.transport ?? createSyncEngine(api))(store);

    // Локальная часть наборов (хуки, обработчики, применение к модели) выполняется строго по
    // очереди; ответа сервера следующее действие не ждёт
    let localQueue: Promise<unknown> = Promise.resolve();

    /**
     * Ставит шаг в локальную очередь и возвращает итог действия
     *
     * @param step - шаг: локальное применение и, если набор не пуст, ожидание его итога
     * @returns итог действия
     */
    function enqueueLocal(step: () => Promise<StepResult>): Promise<ChangeResult> {
        const done = localQueue.then(step);
        localQueue = done.catch(() => undefined);
        return done.then((s) => ('result' in s ? s.result : s.outcome));
    }

    function descendantsFirst(id: string): string[] {
        const result: string[] = [];
        for (const child of getChildren(id)) result.push(...descendantsFirst(child.id));
        result.push(id);
        return result;
    }

    function snapshotOf(object: DataObject): DataObject {
        return { ...object, properties: { ...object.properties } };
    }

    function touch(scope: Scope, edit: LocalEdit, id: string) {
        if (scope.before.has(id)) return;
        const o = edit.get(id);
        scope.before.set(id, o && snapshotOf(o));
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

    function makeScope(hooks: boolean, edit: LocalEdit): { scope: Scope; tx: ChangeScope } {
        const scope: Scope = { operations: [], before: new Map(), hooks, depth: 0, error: null };

        const tx: ChangeScope = {
            create(input) {
                const type = store.getType(input.type);
                if (!type) return refuse(scope, `Тип "${input.type}" неизвестен.`);
                const parent = input.parent ?? null;
                if (parent !== null && !edit.get(parent)) {
                    return refuse(scope, 'Родитель не найден.');
                }
                const id = newId();
                const siblings = getChildren(parent);
                const number = input.number ?? nextNumber(siblings);
                // Значения по умолчанию из определения типа; заданные явно приоритетнее
                const properties: Record<string, unknown> = {};
                for (const p of type.properties ?? []) {
                    if (p.default !== undefined && p.default !== null) properties[p.id] = p.default;
                }
                Object.assign(properties, input.properties);
                const object: DataObject = { id, type: input.type, parent, number, properties };

                const cancelled = runHooks(scope, tx, 'create', 'before', { object });
                if (cancelled !== null) return refuse(scope, cancelled);

                touch(scope, edit, id);
                edit.put(object);
                scope.operations.push({
                    op: 'create',
                    id,
                    type: input.type,
                    parent,
                    number,
                    properties,
                });

                const failed = runHooks(scope, tx, 'create', 'after', {
                    object: snapshotOf(object),
                });
                return failed !== null ? refuse(scope, failed) : { ok: true, id };
            },

            setProperty(id, property, value) {
                const object = edit.get(id);
                if (!object) return refuse(scope, 'Объект не найден.');
                const oldValue = object.properties[property] ?? null;
                const newValue = value ?? null;
                const context = { object: snapshotOf(object), property, oldValue, newValue };

                const cancelled = runHooks(scope, tx, 'setProperty', 'before', context);
                if (cancelled !== null) return refuse(scope, cancelled);

                // Хук «до» мог изменить объект: берём актуальную версию
                const current = edit.get(id);
                if (!current) return refuse(scope, 'Объект не найден.');
                touch(scope, edit, id);
                const properties = { ...current.properties };
                if (newValue === null) delete properties[property];
                else properties[property] = newValue;
                edit.put({ ...current, properties });
                scope.operations.push({
                    op: 'update',
                    id,
                    changes: { [property]: { old: oldValue, new: newValue } },
                });

                const failed = runHooks(scope, tx, 'setProperty', 'after', {
                    ...context,
                    object: snapshotOf(edit.get(id) ?? current),
                });
                return failed !== null ? refuse(scope, failed) : { ok: true };
            },

            move(id, to) {
                const object = edit.get(id);
                if (!object) return refuse(scope, 'Объект не найден.');
                const parent = to.parent === undefined ? object.parent : to.parent;
                if (parent !== null) {
                    if (!edit.get(parent)) return refuse(scope, 'Родитель не найден.');
                    for (
                        let p: string | null = parent;
                        p !== null;
                        p = edit.get(p)?.parent ?? null
                    ) {
                        if (p === id) {
                            return refuse(
                                scope,
                                'Нельзя переместить объект в самого себя или в потомка.',
                            );
                        }
                    }
                }
                const number = to.number ?? object.number;
                if (parent === object.parent && number === object.number) {
                    return refuse(scope, 'Перемещение ничего не меняет.');
                }
                const from = { parent: object.parent, number: object.number };
                const target = { parent, number };
                const context = { object: snapshotOf(object), from, to: target };

                const cancelled = runHooks(scope, tx, 'move', 'before', context);
                if (cancelled !== null) return refuse(scope, cancelled);

                const current = edit.get(id);
                if (!current) return refuse(scope, 'Объект не найден.');
                const operation: Extract<Operation, { op: 'move' }> = { op: 'move', id };
                if (parent !== from.parent) operation.parent = { old: from.parent, new: parent };
                if (number !== from.number) operation.number = { old: from.number, new: number };
                touch(scope, edit, id);
                edit.put({ ...current, parent, number });
                scope.operations.push(operation);

                const failed = runHooks(scope, tx, 'move', 'after', {
                    ...context,
                    object: snapshotOf(edit.get(id) ?? current),
                });
                return failed !== null ? refuse(scope, failed) : { ok: true };
            },

            remove(id) {
                const object = edit.get(id);
                if (!object) return refuse(scope, 'Объект не найден.');
                const removed = snapshotOf(object);

                const cancelled = runHooks(scope, tx, 'remove', 'before', { object: removed });
                if (cancelled !== null) return refuse(scope, cancelled);

                if (!edit.get(id)) return refuse(scope, 'Объект не найден.');
                for (const x of descendantsFirst(id)) {
                    touch(scope, edit, x);
                    edit.drop(x);
                    scope.operations.push({ op: 'delete', id: x });
                }

                const failed = runHooks(scope, tx, 'remove', 'after', { object: removed });
                return failed !== null ? refuse(scope, failed) : { ok: true };
            },
        };
        return { scope, tx };
    }

    /**
     * Выполняет набор: локально применяет операции и ставит набор в очередь хранилища (видно
     * сразу); итог — подтверждение или отказ сервера. При локальном отказе (в том числе вложенной
     * операции) модель возвращается как была, при отказе сервера набор откатывает хранилище
     */
    function execute(
        run: (tx: ChangeScope, scope: Scope) => void | Promise<void>,
        opts: OperationOptions | undefined,
    ): Promise<ChangeResult> {
        return enqueueLocal(async () => {
            const edit = store.beginLocal();
            const { scope, tx } = makeScope(opts?.hooks !== false, edit);
            try {
                await run(tx, scope);
            } catch (error) {
                scope.error ??= errorMessage(error);
            }
            if (scope.error !== null) {
                edit.abort();
                return { result: { ok: false, error: scope.error } };
            }
            if (scope.operations.length === 0) {
                edit.commit([]);
                return { result: { ok: true } };
            }
            const entry: HistoryEntry = {
                forward: scope.operations,
                inverse: invertOperations(scope.operations, scope.before),
            };
            history.record(entry);
            snapshot = { ...snapshot, error: null };
            const { outcome } = edit.commit(scope.operations);
            const settled = outcome.then((result) => {
                if (!result.ok) {
                    history.discard(entry);
                    publish({}, false);
                }
                return result;
            });
            return opts?.confirmed ? { outcome: settled } : { result: { ok: true } };
        });
    }

    /**
     * Ищет расхождение текущей модели с тем, что ожидает набор отмены или повтора: значения
     * «было» у свойств и положения, существование объектов
     *
     * @param operations - операции набора
     * @returns `true`, если модель изменилась в другом месте
     */
    function hasConflict(operations: readonly Operation[]): boolean {
        const view = new Map<string, DataObject>();
        for (const id of touchedIds(operations)) {
            const object = store.getObject(id);
            if (object) view.set(id, object);
        }
        for (const operation of operations) {
            const current = view.get(operation.id);
            switch (operation.op) {
                case 'create':
                    if (current) return true;
                    break;
                case 'delete':
                    if (!current) return true;
                    break;
                case 'update':
                    if (!current) return true;
                    for (const [name, change] of Object.entries(operation.changes)) {
                        if (!sameValue(current.properties[name], change.old)) return true;
                    }
                    break;
                case 'move':
                    if (!current) return true;
                    if (operation.parent && current.parent !== operation.parent.old) return true;
                    if (operation.number && current.number !== operation.number.old) return true;
                    break;
            }
            applyOperations(view, [operation]);
        }
        return false;
    }

    /**
     * Отмена и повтор: применяют сохранённый набор напрямую к модели, минуя `makeScope`,
     * поэтому хуки не вызываются; идут через ту же очередь. Перед применением текущие значения
     * сверяются со своими. При отказе сервера стек остаётся прежним
     */
    function replay(kind: 'undo' | 'redo'): Promise<ChangeResult> {
        const verb = kind === 'undo' ? 'отменить' : 'повторить';
        return enqueueLocal(async () => {
            const entry = kind === 'undo' ? history.peekUndo() : history.peekRedo();
            if (!entry) {
                return {
                    result: {
                        ok: false,
                        error: kind === 'undo' ? 'Нечего отменять.' : 'Нечего повторять.',
                    },
                };
            }
            const operations = kind === 'undo' ? entry.inverse : entry.forward;
            if (hasConflict(operations)) {
                history.discard(entry);
                const error = `Не удалось ${verb}: данные изменены в другом месте.`;
                publish({ error }, false);
                return { result: { ok: false, error } };
            }
            const edit = store.beginLocal();
            for (const operation of operations) edit.apply(operation);
            if (kind === 'undo') history.markUndone();
            else history.markRedone();
            snapshot = { ...snapshot, error: null };
            const { outcome } = edit.commit(operations);
            // Итог локальный: поздний отказ сервера возвращает запись в стек и показан уведомлением
            void outcome.then((result) => {
                if (result.ok) return;
                history.revert(kind, entry);
                publish({}, false);
            });
            return { result: { ok: true } };
        });
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

    function registerTitle(typeId: string, formatter: TitleFormatter) {
        titleFormatters.set(typeId, formatter);
        return () => {
            if (titleFormatters.get(typeId) === formatter) titleFormatters.delete(typeId);
        };
    }

    function getTitle(object: DataObject): string | undefined {
        return titleFormatters.get(object.type)?.(object);
    }

    const registry = createActionRegistry({
        reader: {
            getObject: (id) => store.getObject(id),
            getType: (id) => store.getType(id),
            getTitle,
        },
        execute,
    });

    return {
        async load() {
            publish({ status: 'loading', error: null }, false);
            try {
                await link.resync();
                history.clear();
                publish({ status: 'ready', error: null });
            } catch (error) {
                publish({ status: 'error', error: errorMessage(error) }, false);
            }
        },
        startFromCache(cache) {
            store.reset(cache);
            history.clear();
            publish({ status: 'ready', error: null });
        },
        catchUp: () => link.catchUp(),
        kick: () => link.kick(),
        dispose: () => link.dispose(),
        onNotice: (listener) => store.onNotice(listener),
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        subscribeObject: (id, listener) => store.subscribeObject(id, listener),
        subscribeChildren: (parent, listener) => store.subscribeChildren(parent, listener),
        getType: (id) => store.getType(id),
        getTypes: () => store.getTypes(),
        getObject: (id) => store.getObject(id),
        getChildren,
        sync: store,
        connectPush: (channel) => link.connect(channel),
        getSyncState: () => link.getState(),
        subscribeSyncState: (listener) => link.subscribeState(listener),
        onResync: (listener) => link.onResync(listener),
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
        registerTitle,
        getTitle,
        registerAction: registry.registerAction,
        registerCommand: registry.registerCommand,
        isCommandAvailable: registry.isCommandAvailable,
        runCommand: registry.runCommand,
        getActions: registry.getActions,
        getActionParameters: registry.getActionParameters,
        getGroupActions: registry.getGroupActions,
        groupLaunch: registry.groupLaunch,
        runAction: registry.runAction,
        runActionOnMany: registry.runActionOnMany,
    };
}
