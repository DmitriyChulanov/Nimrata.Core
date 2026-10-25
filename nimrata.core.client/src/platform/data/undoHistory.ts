import type { DataObject } from './DataController';

/** Операция набора изменений в том виде, в каком она уходит на сервер. */
export type Operation = Record<string, unknown>;

/** Одно действие пользователя: набор изменений и обратный ему набор. */
export interface HistoryEntry {
    forward: Operation[];
    inverse: Operation[];
}

/** Стеки отмены и повтора (живут в памяти вкладки). */
export interface UndoHistory {
    /** Записывает успешно применённое действие; стек повторов очищается. */
    record(entry: HistoryEntry): void;
    peekUndo(): HistoryEntry | undefined;
    peekRedo(): HistoryEntry | undefined;
    /** Переносит верхнее действие из стека отмены в стек повторов. */
    markUndone(): void;
    /** Переносит верхнее действие из стека повторов в стек отмены. */
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

function swap(change: unknown): unknown {
    const { old, new: next } = change as { old: unknown; new: unknown };
    return { old: next, new: old };
}

/**
 * Обратная операция. `before` — состояние объекта до применения `operation`
 * (нужно, чтобы пересоздать удалённый объект).
 */
export function invertOperation(operation: Operation, before: DataObject | undefined): Operation {
    const id = operation.id as string;
    switch (operation.op) {
        case 'create':
            return { op: 'delete', id };
        case 'delete':
            return {
                op: 'create',
                id,
                type: before?.type,
                parent: before?.parent ?? null,
                order: before?.order ?? 0,
                properties: { ...before?.properties },
            };
        case 'update': {
            const changes: Record<string, unknown> = {};
            for (const [name, change] of Object.entries(
                operation.changes as Record<string, unknown>,
            )) {
                changes[name] = swap(change);
            }
            return { op: 'update', id, changes };
        }
        case 'move': {
            const inverse: Operation = { op: 'move', id };
            if (operation.parent) inverse.parent = swap(operation.parent);
            if (operation.order) inverse.order = swap(operation.order);
            return inverse;
        }
        default:
            throw new Error(`Неизвестная операция «${String(operation.op)}».`);
    }
}

/** Обратный набор: операции в обратном порядке, каждая инвертирована. */
export function invertOperations(
    operations: Operation[],
    before: ReadonlyMap<string, DataObject | undefined>,
): Operation[] {
    return [...operations]
        .reverse()
        .map((operation) => invertOperation(operation, before.get(operation.id as string)));
}

/** Применяет операции набора к модели (без хуков и без обращения к серверу). */
export function applyOperations(objects: Map<string, DataObject>, operations: Operation[]): void {
    for (const operation of operations) {
        const id = operation.id as string;
        const existing = objects.get(id);
        switch (operation.op) {
            case 'create':
                objects.set(id, {
                    id,
                    type: operation.type as string,
                    parent: (operation.parent as string | null) ?? null,
                    order: (operation.order as number) ?? 0,
                    properties: { ...(operation.properties as Record<string, unknown>) },
                });
                break;
            case 'delete':
                objects.delete(id);
                break;
            case 'update': {
                if (!existing) break;
                const properties = { ...existing.properties };
                for (const [name, change] of Object.entries(
                    operation.changes as Record<string, { new: unknown }>,
                )) {
                    if (change.new === null || change.new === undefined) delete properties[name];
                    else properties[name] = change.new;
                }
                objects.set(id, { ...existing, properties });
                break;
            }
            case 'move': {
                if (!existing) break;
                const parent = operation.parent as { new: string | null } | undefined;
                const order = operation.order as { new: number } | undefined;
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

/** Идентификаторы объектов, которых касаются операции (без повторов). */
export function touchedIds(operations: Operation[]): string[] {
    return [...new Set(operations.map((o) => o.id as string))];
}
