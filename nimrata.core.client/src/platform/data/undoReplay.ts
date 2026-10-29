/**
 * Отмена и повтор действий контроллера данных поверх стека `UndoHistory`: сохранённый набор
 * применяется к модели напрямую (без хуков) через локальную очередь, перед применением текущие
 * значения сверяются с ожидаемыми
 */
import { applyOperations, touchedIds } from './undoHistory';

import type { ChangeResult, DataObject } from './DataController';
import type { DataStore } from './dataStore';
import type { EnqueueLocal } from './localQueue';
import type { Operation, UndoHistory } from './undoHistory';

/**
 * Что нужно отмене и повтору от контроллера
 */
export interface UndoReplayOptions {
    /** Хранилище: текущая видимая модель и локальная правка */
    store: Pick<DataStore, 'getObject' | 'beginLocal'>;
    /** Стек отмены и повтора */
    history: UndoHistory;
    /** Локальная очередь действий контроллера */
    enqueueLocal: EnqueueLocal;
    /**
     * Сообщает об ошибке действия (модель не менялась); `null` — сбросить прежнюю ошибку без
     * уведомления подписчиков
     */
    reportError(error: string | null): void;
    /** Уведомляет подписчиков, что изменилось состояние стека (без изменения модели) */
    notify(): void;
}

/**
 * Отмена и повтор
 */
export interface UndoReplay {
    /** Отменяет последнее действие; итог локальный */
    undo(): Promise<ChangeResult>;
    /** Повторяет отменённое действие; итог локальный */
    redo(): Promise<ChangeResult>;
    /** Есть ли что отменять */
    canUndo(): boolean;
    /** Есть ли что повторять */
    canRedo(): boolean;
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
 * Создаёт отмену и повтор
 *
 * @param options - хранилище, стек, очередь и уведомления контроллера
 * @returns отмена, повтор и их доступность
 */
export function createUndoReplay(options: UndoReplayOptions): UndoReplay {
    const { store, history, enqueueLocal, reportError, notify } = options;

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
     * Применяет сохранённый набор напрямую к модели, минуя хуки; идёт через ту же очередь;
     * при отказе сервера стек возвращается как был
     *
     * @param kind - отмена или повтор
     * @returns локальный итог
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
                reportError(error);
                return { result: { ok: false, error } };
            }
            const edit = store.beginLocal();
            for (const operation of operations) edit.apply(operation);
            if (kind === 'undo') history.markUndone();
            else history.markRedone();
            reportError(null);
            const { outcome } = edit.commit(operations);
            // Итог локальный: поздний отказ сервера возвращает запись в стек и показан уведомлением
            void outcome.then((result) => {
                if (result.ok) return;
                history.revert(kind, entry);
                notify();
            });
            return { result: { ok: true } };
        });
    }

    return {
        undo: () => replay('undo'),
        redo: () => replay('redo'),
        canUndo: () => history.canUndo(),
        canRedo: () => history.canRedo(),
    };
}
