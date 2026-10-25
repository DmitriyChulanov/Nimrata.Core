import type { ChangeScope, DataController, DataObject } from '@platform';

import { CATEGORY, COMPLETED, COMPLETED_TASKS_ROOT, CURRENT_TASKS_ROOT, TASK } from './constants';
import { parseIso } from './dates';
import { ensureCategory, ensureDay, ensureYear, findRoot } from './nodes';
import { orThrow } from './results';
import { taskDate, taskOrder } from './tasks';

/** Названия категорий задачи от внешней к внутренней. */
export function categoryChain(data: DataController, task: DataObject): string[] {
    const names: string[] = [];
    for (let id = task.parent; id;) {
        const parent = data.getObject(id);
        if (!parent || parent.type !== CATEGORY) break;
        names.unshift(String(parent.properties.name ?? ''));
        id = parent.parent;
    }
    return names;
}

/** Удаляет пустые категории, начиная с `start` и вверх; день и выше не трогает. */
export function pruneEmptyCategories(
    data: DataController,
    tx: ChangeScope,
    start: string | null,
): void {
    for (let id = start; id;) {
        const node = data.getObject(id);
        if (!node || node.type !== CATEGORY || data.getChildren(id).length > 0) return;
        const parent = node.parent;
        orThrow(tx.remove(id));
        id = parent;
    }
}

/** Идентификатор корня «Текущие задачи» или «Завершённые задачи» рядом с задачей. */
export function taskRootId(data: DataController, task: DataObject, type: string): string {
    const root = findRoot(data, type, task);
    if (!root) throw new Error('Не найдена группа задач для переноса.');
    return root.id;
}

/** Переносит задачу в день `iso` внутри корня с той же цепочкой категорий; опустевшие убирает. */
function relocate(
    data: DataController,
    tx: ChangeScope,
    task: DataObject,
    iso: string,
    archive: boolean,
): void {
    const ymd = parseIso(iso);
    if (!ymd) throw new Error('Дата должна быть в формате ГГГГ-ММ-ДД.');

    const rootId = taskRootId(data, task, archive ? COMPLETED_TASKS_ROOT : CURRENT_TASKS_ROOT);
    const chain = categoryChain(data, task);
    const oldParent = task.parent;

    const base = archive ? ensureYear(data, tx, rootId, ymd.year) : rootId;
    let container = ensureDay(data, tx, base, ymd);
    for (const name of chain) container = ensureCategory(data, tx, container, name);

    orThrow(tx.move(task.id, { parent: container, order: taskOrder(task) }));
    pruneEmptyCategories(data, tx, oldParent);
}

function isPending(task: DataObject): boolean {
    return task.properties.status !== COMPLETED;
}

/**
 * Действия задачи «Завершить» и «Отложить», очистка опустевших категорий при удалении задачи.
 * Возвращает функцию отписки.
 */
export function registerCompletion(data: DataController): () => void {
    const disposers: (() => void)[] = [];

    disposers.push(
        data.registerAction(
            TASK,
            'complete',
            ({ object, tx }) => {
                const date = taskDate(data, object);
                if (!date) throw new Error('У задачи не найден день.');
                orThrow(tx.setProperty(object.id, 'status', COMPLETED));
                relocate(data, tx, object, date, true);
            },
            { available: isPending },
        ),
        data.registerAction(
            TASK,
            'postpone',
            ({ object, params, tx }) => {
                const date = typeof params.date === 'string' ? params.date : '';
                if (!parseIso(date)) throw new Error('Дата должна быть в формате ГГГГ-ММ-ДД.');
                if (date === taskDate(data, object)) return;
                relocate(data, tx, object, date, false);
            },
            { available: isPending },
        ),
        data.registerHook(TASK, 'remove', 'after', ({ object, tx }) => {
            try {
                pruneEmptyCategories(data, tx, object.parent);
            } catch (error) {
                return { cancel: error instanceof Error ? error.message : String(error) };
            }
        }),
    );

    return () => disposers.forEach((dispose) => dispose());
}
