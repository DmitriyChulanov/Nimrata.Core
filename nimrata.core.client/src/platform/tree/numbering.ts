import { childrenInOrder } from './treeModel';

import type { DataController, DataObject } from '@platform/data/DataController';
import type { TreeReader } from './treeModel';

/**
 * Изменение положения или номера одного объекта; `parent` задаётся, только если объект меняет родителя
 */
export interface NumberChange {
    id: string;
    parent?: string | null;
    number: number;
}

/**
 * Номер последнего потомка плюс 1: куда встаёт объект, опущенный «внутрь» узла
 *
 * @param children - потомки узла в порядке дерева
 * @returns следующий номер; в пустой коллекции — 1
 */
export function nextNumber(children: readonly DataObject[]): number {
    return children.reduce((max, o) => Math.max(max, o.number), 0) + 1;
}

/**
 * Вставка объекта на позицию `index` среди `others` с плотной перенумерацией коллекции 1..N
 * в порядке дерева. Меняются только объекты, чей номер или родитель действительно другой
 *
 * @param dragged - вставляемый объект
 * @param parent - родитель целевой коллекции; `null` — корень
 * @param others - потомки родителя без вставляемого объекта в порядке дерева
 * @param index - позиция вставки среди `others`
 * @returns изменения; пусто, если ничего менять не нужно
 */
export function planInsertion(
    dragged: DataObject,
    parent: string | null,
    others: readonly DataObject[],
    index: number,
): NumberChange[] {
    const ordered = [...others.slice(0, index), dragged, ...others.slice(index)];
    const changes: NumberChange[] = [];
    ordered.forEach((object, i) => {
        const number = i + 1;
        if (object.id === dragged.id) {
            if (object.parent !== parent) changes.push({ id: object.id, parent, number });
            else if (object.number !== number) changes.push({ id: object.id, number });
        } else if (object.number !== number) {
            changes.push({ id: object.id, number });
        }
    });
    return changes;
}

/**
 * Присвоение объекту номера `number`: если он занят среди соседей, все соседи с номером не меньше
 * `number` сдвигаются на +1; свободный номер просто ставится
 *
 * @param reader - доступ к дереву
 * @param object - объект, чей номер меняется
 * @param number - новый номер (целое ≥ 1)
 * @returns изменения; пусто, если номер не меняется
 */
export function planNumberEdit(
    reader: TreeReader,
    object: DataObject,
    number: number,
): NumberChange[] {
    if (object.number === number) return [];
    const siblings = childrenInOrder(reader, object.parent).filter((o) => o.id !== object.id);
    const changes: NumberChange[] = [{ id: object.id, number }];
    if (siblings.some((o) => o.number === number)) {
        for (const sibling of siblings) {
            if (sibling.number >= number)
                changes.push({ id: sibling.id, number: sibling.number + 1 });
        }
    }
    return changes;
}

/**
 * Применяет изменения одним набором: отказ любого перемещения отменяет весь набор
 *
 * @param data - контроллер данных
 * @param changes - изменения номеров и родителей
 * @returns результат набора
 */
export function applyNumberChanges(data: DataController, changes: readonly NumberChange[]) {
    return data.perform((tx) => {
        for (const { id, ...to } of changes) {
            const moved = tx.move(id, to);
            if (!moved.ok) throw new Error(moved.error);
        }
    });
}
