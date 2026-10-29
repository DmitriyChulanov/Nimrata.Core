/**
 * Хранилище клиента в два слоя: подтверждённое состояние (с сервера, до курсора `seq`) и очередь
 * неподтверждённых наборов. Видимая модель — подтверждённое состояние с наложенной очередью.
 * Сетевой части здесь нет: её (отправка, догон, push) подключают через `confirm`, `reject`,
 * `applyRemote` и `subscribePending`
 */
import { checkChangeset } from './changesetRules';
import { applyOperations, touchedIds } from './undoHistory';
import { uuid7 } from './uuid7';

import type { ChangeFailure, ChangeResult, DataObject } from './DataController';
import type { Operation } from './undoHistory';
import type { TypeDefinition } from '@platform/types/types';

/**
 * Неподтверждённый набор изменений в очереди
 */
export interface PendingChangeset {
    /** Идентификатор набора (UUIDv7), по нему узнаётся своё эхо */
    readonly id: string;
    /** Операции набора в порядке применения */
    readonly operations: readonly Operation[];
}

/**
 * Пакет входящих изменений в формате догона `GET /api/changes`
 */
export interface RemoteChanges {
    /** Курсор, до которого изменения учтены */
    toSeq: number;
    /** Финальное состояние затронутых объектов */
    upserts: readonly DataObject[];
    /** Удалённые (или скрытые) объекты */
    deletes: readonly string[];
    /** Идентификаторы наборов, вошедших в пакет (свои узнаются по ним) */
    changesetIds: readonly string[];
}

/**
 * Полная загрузка: курсор снимка, типы и объекты
 */
export interface StoreSnapshot {
    /** Курсор снимка */
    seq: number;
    /** Типы пользователя */
    types: readonly TypeDefinition[];
    /** Видимые объекты пользователя */
    objects: readonly DataObject[];
}

/**
 * Что изменилось в видимой модели за одно применение
 */
export interface StoreChange {
    /** Изменённые объекты (в том числе появившиеся и удалённые) */
    ids: ReadonlySet<string>;
    /** Родители, у которых изменился состав или содержимое детей; `null` — корень */
    parents: ReadonlySet<string | null>;
}

/**
 * Причина отказа набора
 */
export type ChangesetFailure = Omit<ChangeFailure, 'ok'>;

/**
 * Открытая локальная правка видимой модели: изменения видны сразу, но подписчики узнают о них
 * только при `commit`. Пока правка открыта, входящие изменения и итоги откладываются
 */
export interface LocalEdit {
    /** Объект видимой модели с учётом правки */
    get(id: string): DataObject | undefined;
    /** Кладёт объект в видимую модель */
    put(object: DataObject): void;
    /** Убирает объект из видимой модели */
    drop(id: string): void;
    /** Применяет операцию набора к видимой модели */
    apply(operation: Operation): void;
    /**
     * Завершает правку: набор с этими операциями встаёт в очередь (без операций — ничего).
     * `outcome` разрешается при подтверждении или отказе набора
     */
    commit(operations: readonly Operation[]): { id: string; outcome: Promise<ChangeResult> };
    /** Отменяет правку: видимая модель возвращается как была */
    abort(): void;
}

/**
 * Хранилище модели клиента
 */
export interface DataStore {
    /**
     * Заменяет подтверждённый слой снимком сервера и заново накладывает очередь: наборы, невалидные
     * относительно снимка, убираются с одним сводным уведомлением
     */
    reset(snapshot: StoreSnapshot): void;
    /** Курсор подтверждённого состояния */
    getSeq(): number;
    getType(id: string): TypeDefinition | undefined;
    getTypes(): TypeDefinition[];
    /** Объект видимой модели */
    getObject(id: string): DataObject | undefined;
    /** Объект подтверждённого слоя */
    getConfirmedObject(id: string): DataObject | undefined;
    /**
     * Дети родителя в видимой модели по возрастанию номера (затем id); `null` — корень.
     * Ссылка на список сохраняется, пока состав и объекты детей не изменились
     */
    getChildren(parent: string | null): readonly DataObject[];
    /** Очередь неподтверждённых наборов в порядке создания */
    pending(): readonly PendingChangeset[];
    /** Открывает локальную правку (одновременно — не больше одной) */
    beginLocal(): LocalEdit;
    /** Сервер применил свой набор: он переходит в подтверждённый слой */
    confirm(id: string, seq: number): void;
    /** Сервер отклонил свой набор: он и зависящие от него наборы убираются из очереди */
    reject(id: string, failure: ChangesetFailure): void;
    /** Применяет входящие изменения к подтверждённому слою и заново накладывает очередь */
    applyRemote(changes: RemoteChanges): void;
    /** Подписка на любое изменение видимой модели */
    subscribe(listener: (change: StoreChange) => void): () => void;
    /** Подписка на изменения одного объекта */
    subscribeObject(id: string, listener: () => void): () => void;
    /** Подписка на изменения детей родителя (`null` — корень) */
    subscribeChildren(parent: string | null, listener: () => void): () => void;
    /** Подписка на сдвиг курсора подтверждённого состояния */
    subscribeSeq(listener: () => void): () => void;
    /** Подписка на изменение очереди (новый набор, подтверждение, отказ) */
    subscribePending(listener: () => void): () => void;
    /** Подписка на сводные уведомления об отказах (одно на каждое применение) */
    onNotice(listener: (message: string) => void): () => void;
    /**
     * Восстанавливает сохранённые наборы (очередь после перезагрузки или закрытой вкладки) в конец
     * очереди без локальной правки: итогов никто не ждёт, хуки не запускаются, наборы с известным
     * id пропускаются. Восстановленный набор, неприменимый к подтверждённому слою (его могли уже
     * применить на сервере), без сервера не отбрасывается: он не накладывается и ждёт итога
     */
    restoreQueue(changesets: readonly PendingChangeset[]): void;
    /** Подтверждённый слой для сохранения в кэш: курсор, типы и объекты */
    confirmedSnapshot(): StoreSnapshot;
}

/**
 * Параметры хранилища
 */
export interface DataStoreOptions {
    /** Генератор идентификаторов наборов (по умолчанию UUIDv7) */
    newChangesetId?: () => string;
}

/**
 * Набор в очереди вместе с ожиданием его итога
 */
interface QueueEntry extends PendingChangeset {
    /** Разрешает итог набора */
    settle: (result: ChangeResult) => void;
    /** Набор восстановлен из сохранённой очереди: неприменимый ждёт итога сервера, а не отбрасывается */
    restored?: boolean;
    /** Восстановленный набор при последнем наложении не применился (ждёт итога сервера) */
    skipped?: boolean;
}

/**
 * Совпадают ли два объекта по содержимому
 *
 * @param a - первый объект
 * @param b - второй объект
 * @returns `true`, если тип, родитель, номер и свойства равны
 */
function sameObject(a: DataObject | undefined, b: DataObject | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
        a.type === b.type &&
        a.parent === b.parent &&
        a.number === b.number &&
        JSON.stringify(a.properties) === JSON.stringify(b.properties)
    );
}

/**
 * Ссылается ли операция на один из объектов (целью, родителем или значением свойства)
 *
 * @param operation - операция набора
 * @param ids - идентификаторы объектов
 * @returns `true`, если операция зависит от этих объектов
 */
function dependsOn(operation: Operation, ids: ReadonlySet<string>): boolean {
    if (ids.has(operation.id)) return true;
    const mentions = (value: unknown) => typeof value === 'string' && ids.has(value);
    switch (operation.op) {
        case 'create':
            return mentions(operation.parent) || Object.values(operation.properties).some(mentions);
        case 'update':
            return Object.values(operation.changes).some((c) => mentions(c.new));
        case 'move':
            return mentions(operation.parent?.new);
        default:
            return false;
    }
}

/**
 * Порядок детей: номер, затем идентификатор
 *
 * @param a - первый объект
 * @param b - второй объект
 * @returns знак сравнения
 */
function byNumber(a: DataObject, b: DataObject): number {
    return a.number - b.number || (a.id < b.id ? -1 : 1);
}

/**
 * Создаёт пустое хранилище
 *
 * @param options - генератор идентификаторов наборов
 * @returns хранилище; данные кладёт `reset`
 */
export function createDataStore(options: DataStoreOptions = {}): DataStore {
    const newChangesetId = options.newChangesetId ?? uuid7;
    let seq = 0;
    let types = new Map<string, TypeDefinition>();
    let confirmed = new Map<string, DataObject>();
    let visible = new Map<string, DataObject>();
    let queue: QueueEntry[] = [];

    // Индекс «родитель → дети»: перестраивается лениво; списки неизменившихся родителей сохраняются
    let childrenIndex = new Map<string | null, readonly DataObject[]>();
    let indexStale = true;
    const dirtyParents = new Set<string | null>();
    let fullRebuild = true;

    const listeners = new Set<(change: StoreChange) => void>();
    const objectListeners = new Map<string, Set<() => void>>();
    const childrenListeners = new Map<string | null, Set<() => void>>();
    const pendingListeners = new Set<() => void>();
    const seqListeners = new Set<() => void>();
    const noticeListeners = new Set<(message: string) => void>();

    // Открытая локальная правка: состояние затронутых объектов до неё; `undefined` — не было
    let local: Map<string, DataObject | undefined> | null = null;
    const deferred: (() => void)[] = [];

    /**
     * Отмечает изменение объекта для индекса детей
     *
     * @param before - объект до изменения
     * @param after - объект после изменения
     */
    function markDirty(before: DataObject | undefined, after: DataObject | undefined) {
        if (before) dirtyParents.add(before.parent);
        if (after) dirtyParents.add(after.parent);
        indexStale = true;
    }

    /**
     * Перестраивает индекс детей, сохраняя списки родителей, которые не менялись
     */
    function ensureIndex() {
        if (!indexStale) return;
        const lists = new Map<string | null, DataObject[]>();
        for (const o of visible.values()) {
            const list = lists.get(o.parent);
            if (list) list.push(o);
            else lists.set(o.parent, [o]);
        }
        const next = new Map<string | null, readonly DataObject[]>();
        for (const [parent, list] of lists) {
            const previous = childrenIndex.get(parent);
            next.set(
                parent,
                !fullRebuild && previous && !dirtyParents.has(parent)
                    ? previous
                    : list.sort(byNumber),
            );
        }
        childrenIndex = next;
        dirtyParents.clear();
        fullRebuild = false;
        indexStale = false;
    }

    const EMPTY: readonly DataObject[] = Object.freeze([]);

    /**
     * Сообщает подписчикам об изменении видимой модели
     *
     * @param change - изменённые объекты и родители
     */
    function notify(change: StoreChange) {
        if (change.ids.size === 0 && change.parents.size === 0) return;
        const called = new Set<() => void>();
        const call = (set: Set<() => void> | undefined) => {
            for (const listener of [...(set ?? [])]) {
                if (called.has(listener)) continue;
                called.add(listener);
                listener();
            }
        };
        for (const id of change.ids) call(objectListeners.get(id));
        for (const parent of change.parents) call(childrenListeners.get(parent));
        for (const listener of [...listeners]) listener(change);
    }

    /**
     * Сдвигает курсор и сообщает подписчикам курсора
     *
     * @param next - новый курсор
     */
    function moveSeq(next: number) {
        if (next === seq) return;
        seq = next;
        for (const listener of [...seqListeners]) listener();
    }

    /**
     * Сообщает подписчикам очереди
     */
    function notifyPending() {
        for (const listener of [...pendingListeners]) listener();
    }

    /**
     * Сообщает сводное уведомление
     *
     * @param message - текст для пользователя
     */
    function notice(message: string) {
        for (const listener of [...noticeListeners]) listener(message);
    }

    /**
     * Выполняет сразу или, если открыта локальная правка, после неё
     *
     * @param run - действие над слоями
     */
    function whenIdle(run: () => void) {
        if (local) deferred.push(run);
        else run();
    }

    /**
     * Завершает локальную правку и выполняет отложенное
     */
    function closeLocal() {
        local = null;
        while (deferred.length > 0 && !local) deferred.shift()?.();
    }

    /**
     * Заново накладывает очередь на подтверждённый слой. Набор, невалидный относительно нового
     * состояния (общие правила контракта) или зависящий от убранного, убирается из очереди.
     * Неизменившиеся объекты сохраняют прежние ссылки
     *
     * @param candidates - объекты, которые могли измениться помимо операций очереди
     * @param failed - набор, уже отклонённый сервером (убирается первым), и его причина
     * @returns убранные из очереди наборы с причинами
     */
    function rebase(
        candidates: Iterable<string>,
        failed?: { entry: QueueEntry; failure: ChangesetFailure },
    ): { entry: QueueEntry; failure: ChangesetFailure }[] {
        const touched = new Set(candidates);
        for (const entry of queue) for (const id of touchedIds(entry.operations)) touched.add(id);
        const next = new Map(confirmed);
        const kept: QueueEntry[] = [];
        const dropped: { entry: QueueEntry; failure: ChangesetFailure }[] = [];
        const poisoned = new Set<string>();
        const drop = (entry: QueueEntry, failure: ChangesetFailure) => {
            dropped.push({ entry, failure });
            for (const op of entry.operations) if (op.op === 'create') poisoned.add(op.id);
        };
        if (failed) drop(failed.entry, failed.failure);
        for (const entry of queue) {
            if (entry === failed?.entry) continue;
            if (poisoned.size > 0 && entry.operations.some((op) => dependsOn(op, poisoned))) {
                drop(entry, { error: 'Изменение зависит от отклонённого набора изменений.' });
                continue;
            }
            const check = checkChangeset(
                types,
                next,
                entry.operations as unknown as Record<string, unknown>[],
            );
            if (!check.ok && entry.restored) {
                // Возможно, уже применён на сервере: решит итог (`duplicate` или отказ)
                entry.skipped = true;
                kept.push(entry);
                continue;
            }
            if (!check.ok) {
                drop(entry, { error: check.error, ...(check.code ? { code: check.code } : {}) });
                continue;
            }
            applyOperations(next, entry.operations);
            entry.skipped = false;
            kept.push(entry);
        }
        queue = kept;

        const ids = new Set<string>();
        const parents = new Set<string | null>();
        for (const id of touched) {
            const before = visible.get(id);
            const after = next.get(id);
            if (sameObject(before, after)) {
                if (before) {
                    next.set(id, before);
                    // Одна ссылка на неизменившийся объект в обоих слоях
                    if (sameObject(confirmed.get(id), before)) confirmed.set(id, before);
                }
                continue;
            }
            ids.add(id);
            if (before) parents.add(before.parent);
            if (after) parents.add(after.parent);
            markDirty(before, after);
        }
        visible = next;
        notify({ ids, parents });
        return dropped;
    }

    /**
     * Разрешает итоги убранных наборов и выдаёт одно сводное уведомление
     *
     * @param dropped - убранные наборы с причинами
     * @param rejectedByServer - первый из них отклонён сервером (а не правилами при переналожении)
     */
    function settleDropped(
        dropped: { entry: QueueEntry; failure: ChangesetFailure }[],
        rejectedByServer: boolean,
    ) {
        if (dropped.length === 0) return;
        for (const { entry, failure } of dropped) entry.settle({ ok: false, ...failure });
        const [first, ...rest] = dropped;
        const reason = first?.failure.error ?? '';
        let message = rejectedByServer
            ? reason
            : `Изменение отменено после обновления данных: ${reason}`;
        if (rest.length > 0) message += ` Отменены также зависимые изменения: ${rest.length}.`;
        notice(message);
        notifyPending();
    }

    return {
        reset(snapshot) {
            whenIdle(() => {
                types = new Map(snapshot.types.map((t) => [t.id, t]));
                confirmed = new Map(snapshot.objects.map((o) => [o.id, { ...o }]));
                const candidates = new Set([...visible.keys(), ...confirmed.keys()]);
                // Типы могли смениться (подключено или отключено расширение): индекс детей целиком
                fullRebuild = true;
                indexStale = true;
                const dropped = rebase(candidates);
                // Общие подписчики узнают о загрузке, даже если объекты не изменились (могли смениться типы)
                for (const listener of [...listeners])
                    listener({ ids: new Set(), parents: new Set() });
                moveSeq(snapshot.seq);
                settleDropped(dropped, false);
            });
        },
        getSeq: () => seq,
        getType: (id) => types.get(id),
        getTypes: () => [...types.values()],
        getObject: (id) => visible.get(id),
        getConfirmedObject: (id) => confirmed.get(id),
        getChildren(parent) {
            ensureIndex();
            return childrenIndex.get(parent) ?? EMPTY;
        },
        pending: () => queue.map(({ id, operations }) => ({ id, operations })),

        beginLocal() {
            if (local) throw new Error('Локальная правка уже открыта.');
            const before = new Map<string, DataObject | undefined>();
            local = before;
            let open = true;
            const remember = (id: string) => {
                if (!before.has(id)) before.set(id, visible.get(id));
            };
            const assertOpen = () => {
                if (!open) throw new Error('Локальная правка уже завершена.');
            };
            const edit: LocalEdit = {
                get: (id) => visible.get(id),
                put(object) {
                    assertOpen();
                    remember(object.id);
                    markDirty(visible.get(object.id), object);
                    visible.set(object.id, object);
                },
                drop(id) {
                    assertOpen();
                    remember(id);
                    markDirty(visible.get(id), undefined);
                    visible.delete(id);
                },
                apply(operation) {
                    assertOpen();
                    applyOperations(
                        {
                            get: (id) => visible.get(id),
                            set: (_id, object) => {
                                edit.put(object);
                                return visible;
                            },
                            delete: (id) => {
                                const had = visible.has(id);
                                edit.drop(id);
                                return had;
                            },
                        },
                        [operation],
                    );
                },
                commit(operations) {
                    assertOpen();
                    open = false;
                    const id = newChangesetId();
                    let settle: (result: ChangeResult) => void = () => {};
                    const outcome = new Promise<ChangeResult>((resolve) => {
                        settle = resolve;
                    });
                    const ids = new Set<string>();
                    const parents = new Set<string | null>();
                    for (const [objectId, was] of before) {
                        const now = visible.get(objectId);
                        if (was === now) continue;
                        ids.add(objectId);
                        if (was) parents.add(was.parent);
                        if (now) parents.add(now.parent);
                    }
                    if (operations.length > 0) {
                        queue.push({ id, operations: [...operations], settle });
                    } else {
                        settle({ ok: true });
                    }
                    notify({ ids, parents });
                    if (operations.length > 0) notifyPending();
                    closeLocal();
                    return { id, outcome };
                },
                abort() {
                    assertOpen();
                    open = false;
                    for (const [objectId, was] of before) {
                        markDirty(visible.get(objectId), was);
                        if (was) visible.set(objectId, was);
                        else visible.delete(objectId);
                    }
                    closeLocal();
                },
            };
            return edit;
        },

        confirm(id, confirmedSeq) {
            whenIdle(() => {
                const entry = queue.find((e) => e.id === id);
                if (!entry) return;
                // Частый случай — подтверждён первый применённый набор очереди: видимая модель
                // (подтверждённый слой + очередь) от этого не меняется, переналожение не нужно.
                // Это держит стоимость подтверждения O(операций), а не O(очередь × модель)
                const head = queue[0] === entry && !entry.skipped && confirmedSeq > seq;
                queue = head ? queue.slice(1) : queue.filter((e) => e !== entry);
                // Набор с seq не больше курсора уже входит в подтверждённое состояние
                if (confirmedSeq > seq) applyOperations(confirmed, entry.operations);
                if (head) {
                    // Одна ссылка на совпадающий объект в обоих слоях: следующее переналожение
                    // копирует подтверждённый слой и не должно молча подменить объекты видимой модели
                    for (const objectId of touchedIds(entry.operations)) {
                        const shown = visible.get(objectId);
                        if (shown && sameObject(confirmed.get(objectId), shown)) {
                            confirmed.set(objectId, shown);
                        }
                    }
                }
                if (confirmedSeq === seq + 1) moveSeq(confirmedSeq);
                const dropped = head ? [] : rebase(touchedIds(entry.operations));
                entry.settle({ ok: true });
                notifyPending();
                settleDropped(dropped, false);
            });
        },

        reject(id, failure) {
            whenIdle(() => {
                const entry = queue.find((e) => e.id === id);
                if (!entry) return;
                settleDropped(rebase([], { entry, failure }), true);
            });
        },

        applyRemote(changes) {
            whenIdle(() => {
                if (changes.toSeq < seq) return;
                const candidates = new Set<string>();
                for (const object of changes.upserts) {
                    confirmed.set(object.id, { ...object });
                    candidates.add(object.id);
                }
                for (const objectId of changes.deletes) {
                    confirmed.delete(objectId);
                    candidates.add(objectId);
                }
                moveSeq(changes.toSeq);
                const own = new Set(changes.changesetIds);
                const echoed = queue.filter((e) => own.has(e.id));
                queue = queue.filter((e) => !own.has(e.id));
                for (const entry of echoed) {
                    for (const objectId of touchedIds(entry.operations)) {
                        candidates.add(objectId);
                    }
                }
                const dropped = rebase(candidates);
                for (const entry of echoed) entry.settle({ ok: true });
                if (echoed.length > 0) notifyPending();
                settleDropped(dropped, false);
            });
        },

        restoreQueue(changesets) {
            whenIdle(() => {
                const known = new Set(queue.map((e) => e.id));
                const added: QueueEntry[] = [];
                for (const { id, operations } of changesets) {
                    if (known.has(id)) continue;
                    known.add(id);
                    added.push({
                        id,
                        operations: [...operations],
                        settle: () => {},
                        restored: true,
                    });
                }
                if (added.length === 0) return;
                queue = [...queue, ...added];
                const dropped = rebase([]);
                notifyPending();
                settleDropped(dropped, false);
            });
        },
        confirmedSnapshot: () => ({
            seq,
            types: [...types.values()],
            objects: [...confirmed.values()],
        }),

        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        subscribeObject(id, listener) {
            return addTo(objectListeners, id, listener);
        },
        subscribeChildren(parent, listener) {
            return addTo(childrenListeners, parent, listener);
        },
        subscribeSeq(listener) {
            seqListeners.add(listener);
            return () => {
                seqListeners.delete(listener);
            };
        },
        subscribePending(listener) {
            pendingListeners.add(listener);
            return () => {
                pendingListeners.delete(listener);
            };
        },
        onNotice(listener) {
            noticeListeners.add(listener);
            return () => {
                noticeListeners.delete(listener);
            };
        },
    };
}

/**
 * Добавляет подписчика в группу по ключу
 *
 * @template K - тип ключа
 * @param groups - подписчики по ключам
 * @param key - ключ (объект или родитель)
 * @param listener - подписчик
 * @returns функция отписки
 */
function addTo<K>(groups: Map<K, Set<() => void>>, key: K, listener: () => void): () => void {
    let set = groups.get(key);
    if (!set) {
        set = new Set();
        groups.set(key, set);
    }
    set.add(listener);
    return () => {
        set.delete(listener);
        if (set.size === 0) groups.delete(key);
    };
}
