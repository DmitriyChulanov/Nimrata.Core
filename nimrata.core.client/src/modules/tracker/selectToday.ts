import { CURRENT_TASKS_ROOT, DAY_TYPES, SELECT_TODAY } from './constants';
import { todayIso } from './dates';
import { findRoot } from './nodes';

import type { DataController, DataObject } from '@platform';

/**
 * День с сегодняшней датой внутри «Текущих задач»; `undefined`, если его ещё нет
 */
export function findToday(data: DataController): DataObject | undefined {
    const today = todayIso();
    const walk = (parent: string): DataObject | undefined => {
        for (const child of data.getChildren(parent)) {
            if (DAY_TYPES.includes(child.type)) {
                if (child.properties.date === today) return child;
                continue;
            }
            const found = walk(child.id);
            if (found) return found;
        }
        return undefined;
    };
    const root = findRoot(data, CURRENT_TASKS_ROOT);
    return root && walk(root.id);
}

/**
 * Нет ли у пользователя механизма «Выделить текущий день» (его нужно создать)
 */
export function needsSelectToday(data: DataController): boolean {
    return !data.getChildren(null).some((o) => o.type === SELECT_TODAY);
}

/**
 * Подключает действие «Выделить»: находит сегодняшний день и показывает его в дереве
 */
export function registerSelectToday(
    data: DataController,
    reveal: ((id: string) => void) | undefined,
): () => void {
    return data.registerAction(SELECT_TODAY, 'selectToday', () => {
        const day = findToday(data);
        if (!day) throw new Error('На сегодня в «Текущих задачах» ещё нет дня.');
        reveal?.(day.id);
    });
}
