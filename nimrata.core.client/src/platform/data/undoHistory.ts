import type { DataObject } from './DataController';

/** Изменение значения: было и стало */
export interface ValueChange<T> {
    old: T;
    new: T;
}

/** Операция набора изменений в том виде, в каком она уходит на сервер */
export type Operation =
    | {
          op: 'create';
          id: string;
          type: string;
          parent: string | null;
          order: number;
          properties: Record<string, unknown>;
      }
    | { op: 'update'; id: string; changes: Record<string, ValueChange<unknown>> }
    | { op: 'move'; id: string; parent?: ValueChange<string | null>; order?: ValueChange<number> }
    | { op: 'delete'; id: string };

/** Одно действие пользователя: набор изменений и обратный ему набор */
export interface HistoryEntry {
    forward: Operation[];
    inverse: Operation[];
}

/** Стеки отмены и повтора (живут в памяти вкладки) */
export interface UndoHistory {
    /** Записывает успешно применённое действие; стек повторов очищается */
    record(entry: HistoryEntry): void;
    peekUndo(): HistoryEntry | undefined;
    peekRedo(): HistoryEntry | undefined;
    /** Переносит верхнее действие из стека отмены в стек повторов */
    markUndone(): void;
    /** Переносит верхнее действие из стека повторов в стек отмены */
    markRedone(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    clear(): void;
}

export function createUndoHistory(): UndoHistory {
    let undo: HistoryEntry[] = [];
    let redo: HistoryEntry[] = [];
    return {
        record(entry) {
            undo.push(entry);
            redo = [];
        },
        peekUndo: () => undo[undo.length - 1],
        peekRedo: () => redo[redo.length - 1],
        markUndone() {
            const entry = undo.pop();
            if (entry) redo.push(entry);
        },
        markRedone() {
            const entry = redo.pop();
            if (entry) undo.push(entry);
        },
        canUndo: () => undo.length > 0,
        canRedo: () => redo.length > 0,
        clear() {
            undo = [];
            redo = [];
        },
    };
}

function assertNever(value: never): never {
    throw new Error(`Неизвестная операция: ${JSON.stringify(value)}.`);
}

function swap<T>(change: ValueChange<T>): ValueChange<T> {
    return { old: change.new, new: change.old };
}

/**
 * Обратная операция. `before` — состояние объекта до применения `operation`
 * (нужно, чтобы пересоздать удалённый объект)
 */
export function invertOperation(operation: Operation, before: DataObject | undefined): Operation {
    switch (operation.op) {
        case 'create':
            return { op: 'delete', id: operation.id };
        case 'delete':
            if (!before) throw new Error(`Нет состояния удалённого объекта ${operation.id}.`);
            return {
                op: 'create',
                id: operation.id,
                type: before.type,
                parent: before.parent ?? null,
                order: before.order,
                properties: { ...before.properties },
            };
        case 'update': {
            const changes: Record<string, ValueChange<unknown>> = {};
            for (const [name, change] of Object.entries(operation.changes)) {
                changes[name] = swap(change);
            }
            return { op: 'update', id: operation.id, changes };
        }
        case 'move': {
            const inverse: Extract<Operation, { op: 'move' }> = { op: 'move', id: operation.id };
            if (operation.parent) inverse.parent = swap(operation.parent);
            if (operation.order) inverse.order = swap(operation.order);
            return inverse;
        }
        default:
            return assertNever(operation);
    }
}

/** Обратный набор: операции в обратном порядке, каждая инвертирована */
export function invertOperations(
    operations: Operation[],
    before: ReadonlyMap<string, DataObject | undefined>,
): Operation[] {
    return [...operations]
        .reverse()
        .map((operation) => invertOperation(operation, before.get(operation.id)));
}

/** Применяет операции набора к модели (без хуков и без обращения к серверу) */
export function applyOperations(objects: Map<string, DataObject>, operations: Operation[]): void {
    for (const operation of operations) {
        const id = operation.id;
        const existing = objects.get(id);
        switch (operation.op) {
            case 'create':
                objects.set(id, {
                    id,
                    type: operation.type,
                    parent: operation.parent,
                    order: operation.order,
                    properties: { ...operation.properties },
                });
                break;
            case 'delete':
                objects.delete(id);
                break;
            case 'update': {
                if (!existing) break;
                const properties = { ...existing.properties };
                for (const [name, change] of Object.entries(operation.changes)) {
                    if (change.new === null || change.new === undefined) delete properties[name];
                    else properties[name] = change.new;
                }
                objects.set(id, { ...existing, properties });
                break;
            }
            case 'move': {
                if (!existing) break;
                const { parent, order } = operation;
                objects.set(id, {
                    ...existing,
                    parent: parent ? parent.new : existing.parent,
                    order: order ? order.new : existing.order,
                });
                break;
            }
        }
    }
}

/** Идентификаторы объектов, которых касаются операции (без повторов) */
export function touchedIds(operations: Operation[]): string[] {
    return [...new Set(operations.map((o) => o.id))];
}
