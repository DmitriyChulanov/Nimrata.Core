import { ApiError } from '../api/apiClient';
import type { ApiClient } from '../api/apiClient';
import type { TypeDefinition } from '../types/types';
import { uuid7 } from './uuid7';

/** Объект в дереве: значения свойств лежат в `properties`, отсутствующее значение — нет ключа. */
export interface DataObject {
    id: string;
    type: string;
    parent: string | null;
    order: number;
    properties: Record<string, unknown>;
}

export type DataStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Состояние модели для подписчиков UI (неизменяемый снимок). */
export interface DataSnapshot {
    status: DataStatus;
    /** Версия модели: растёт при каждом изменении (удобно для `useSyncExternalStore`). */
    version: number;
    /** Причина последней ошибки загрузки или отказа сервера; `null`, если всё в порядке. */
    error: string | null;
    /** Данные разошлись с сервером: нужно вызвать `reload()`. */
    needsReload: boolean;
}

/** Результат изменения: успех либо причина отказа, пригодная для показа пользователю. */
export type ChangeResult = { ok: true } | { ok: false; error: string };
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

export interface CreateInput {
    type: string;
    parent?: string | null;
    /** Порядок среди соседей; без него объект добавляется последним. */
    order?: number;
    properties?: Record<string, unknown>;
}

export interface MoveInput {
    parent?: string | null;
    order?: number;
}

export interface DataControllerOptions {
    api: ApiClient;
    /** Генератор идентификаторов новых объектов (по умолчанию UUIDv7). */
    newId?: () => string;
}

export interface DataController {
    /** Загружает типы и объекты пользователя, заменяя модель. */
    load(): Promise<void>;
    getSnapshot(): DataSnapshot;
    subscribe(listener: () => void): () => void;
    getType(id: string): TypeDefinition | undefined;
    getTypes(): TypeDefinition[];
    getObject(id: string): DataObject | undefined;
    /** Потомки родителя по возрастанию порядка; `null` — корневые объекты. */
    getChildren(parent: string | null): DataObject[];
    /**
     * Порядок для вставки на позицию `index` среди потомков `parent`
     * (объект `exclude` — перемещаемый, в соседи не входит).
     */
    orderAt(parent: string | null, index: number, exclude?: string): number;
    /** Создаёт объект (одно действие — один набор изменений). */
    create(input: CreateInput): Promise<CreateResult>;
    /** Меняет свойство; 
ull удаляет значение. */
    setProperty(id: string, property: string, value: unknown): Promise<ChangeResult>;
    move(id: string, to: MoveInput): Promise<ChangeResult>;
    /** Удаляет объект вместе с потомками одним набором. */
    remove(id: string): Promise<ChangeResult>;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function createDataController(options: DataControllerOptions): DataController {
    const { api } = options;

    let types = new Map<string, TypeDefinition>();
    let objects = new Map<string, DataObject>();
    let snapshot: DataSnapshot = { status: 'idle', version: 0, error: null, needsReload: false };
    const listeners = new Set<() => void>();

    function publish(patch: Partial<DataSnapshot>, model = true) {
        snapshot = { ...snapshot, ...patch, version: snapshot.version + (model ? 1 : 0) };
        for (const listener of [...listeners]) listener();
    }

    function getChildren(parent: string | null, exclude?: string): DataObject[] {
        return [...objects.values()]
            .filter((o) => o.parent === parent && o.id !== exclude)
            .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    }

    const newId = options.newId ?? uuid7;
    // Изменения выполняются строго по очереди, чтобы откат одного не затирал соседние.
    let queue: Promise<unknown> = Promise.resolve();

    function descendantsFirst(id: string): string[] {
        const result: string[] = [];
        for (const child of getChildren(id)) result.push(...descendantsFirst(child.id));
        result.push(id);
        return result;
    }

    /**
     * Применяет изменение локально, отправляет набор на сервер и при отказе возвращает
     * затронутые объекты в прежнее состояние. `build` вызывается в момент выполнения очереди.
     */
    function commit(
        touched: () => string[],
        build: () => { operations: Record<string, unknown>[]; apply: () => void } | string,
    ): Promise<ChangeResult> {
        const run = async (): Promise<ChangeResult> => {
            if (snapshot.needsReload) {
                return { ok: false, error: 'Данные разошлись с сервером: перезагрузите данные.' };
            }
            const built = build();
            if (typeof built === 'string') return { ok: false, error: built };

            const ids = touched();
            const before = new Map(
                ids.map((id) => {
                    const o = objects.get(id);
                    return [id, o && { ...o, properties: { ...o.properties } }] as const;
                }),
            );
            built.apply();
            publish({ error: null });
            try {
                await api.post('changesets', { operations: built.operations });
                return { ok: true };
            } catch (error) {
                for (const [id, o] of before) {
                    if (o) objects.set(id, o);
                    else objects.delete(id);
                }
                publish({
                    error: errorMessage(error),
                    needsReload: error instanceof ApiError && error.status === 409,
                });
                return { ok: false, error: errorMessage(error) };
            }
        };
        const result = queue.then(run);
        queue = result;
        return result;
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
            if (siblings.length === 0) return 0;
            if (index <= 0) return siblings[0].order - 1;
            if (index >= siblings.length) return siblings[siblings.length - 1].order + 1;
            return (siblings[index - 1].order + siblings[index].order) / 2;
        },
        async create(input) {
            const id = newId();
            const parent = input.parent ?? null;
            const result = await commit(
                () => [id],
                () => {
                    if (!types.has(input.type)) return `Тип "${input.type}" неизвестен.`;
                    if (parent !== null && !objects.has(parent)) return 'Родитель не найден.';
                    const siblings = getChildren(parent);
                    const order =
                        input.order ?? (siblings.length ? siblings[siblings.length - 1].order + 1 : 0);
                    const properties = { ...input.properties };
                    return {
                        operations: [{ op: 'create', id, type: input.type, parent, order, properties }],
                        apply: () => {
                            objects.set(id, { id, type: input.type, parent, order, properties });
                        },
                    };
                },
            );
            return result.ok ? { ok: true, id } : result;
        },
        setProperty: (id, property, value) =>
            commit(
                () => [id],
                () => {
                    const object = objects.get(id);
                    if (!object) return 'Объект не найден.';
                    const old = object.properties[property] ?? null;
                    const next = value ?? null;
                    return {
                        operations: [{ op: 'update', id, changes: { [property]: { old, new: next } } }],
                        apply: () => {
                            const properties = { ...object.properties };
                            if (next === null) delete properties[property];
                            else properties[property] = next;
                            objects.set(id, { ...object, properties });
                        },
                    };
                },
            ),
        move: (id, to) =>
            commit(
                () => [id],
                () => {
                    const object = objects.get(id);
                    if (!object) return 'Объект не найден.';
                    const parent = to.parent === undefined ? object.parent : to.parent;
                    if (parent !== null) {
                        if (!objects.has(parent)) return 'Родитель не найден.';
                        for (let p: string | null = parent; p !== null; p = objects.get(p)?.parent ?? null) {
                            if (p === id) return 'Нельзя переместить объект в самого себя или в потомка.';
                        }
                    }
                    const operation: Record<string, unknown> = { op: 'move', id };
                    if (parent !== object.parent) operation.parent = { old: object.parent, new: parent };
                    const order = to.order ?? object.order;
                    if (order !== object.order) operation.order = { old: object.order, new: order };
                    if (!operation.parent && !operation.order) return 'Перемещение ничего не меняет.';
                    return {
                        operations: [operation],
                        apply: () => {
                            objects.set(id, { ...object, parent, order });
                        },
                    };
                },
            ),
        remove: (id) => {
            const ids = () => (objects.has(id) ? descendantsFirst(id) : []);
            return commit(ids, () =>
                objects.has(id)
                    ? {
                          operations: ids().map((x) => ({ op: 'delete', id: x })),
                          apply: () => {
                              for (const x of ids()) objects.delete(x);
                          },
                      }
                    : 'Объект не найден.',
            );
        },
    };
}

