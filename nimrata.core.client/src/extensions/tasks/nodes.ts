// Узлы дерева Трекера: поиск и создание по требованию (годы, месяцы, дни, категории), корни

import { createNode } from '@platform';

import { CATEGORY, DAY, DAY_OFF, DAY_TYPES, MONTH, TASKS_ROOT, YEAR } from './constants';
import { dayName, isWeekend, monthName, pad } from './dates';

import type { ChangeScope, DataController, DataObject } from '@platform';
import type { Ymd } from './dates';

/**
 * Категории дня идут перед задачами (у задач порядок не меньше 0)
 */
const CATEGORY_ORDER = -1;

/**
 * Потомок `parent` одного из типов `types`, подходящий под условие
 */
export function findChild(
    data: DataController,
    parent: string,
    types: string | string[],
    match: (o: DataObject) => boolean,
): DataObject | undefined {
    const list = Array.isArray(types) ? types : [types];
    return data.getChildren(parent).find((o) => list.includes(o.type) && match(o));
}

/**
 * Обходит дни (рабочие и выходные) внутри `parent` на любой глубине, не заходя внутрь дней
 *
 * @param data - контроллер данных
 * @param parent - идентификатор объекта, внутри которого ищутся дни
 * @param visit - вызывается для каждого найденного дня
 */
export function forEachDay(
    data: DataController,
    parent: string,
    visit: (day: DataObject) => void,
): void {
    for (const child of data.getChildren(parent)) {
        if (DAY_TYPES.includes(child.type)) visit(child);
        else forEachDay(data, child.id, visit);
    }
}

/**
 * Находит потомка или создаёт его; возвращает идентификатор
 */
function ensureNode(
    data: DataController,
    tx: ChangeScope,
    parent: string,
    type: string,
    match: (o: DataObject) => boolean,
    properties: Record<string, unknown>,
    order: number,
): string {
    return (
        findChild(data, parent, type, match)?.id ?? createNode(tx, parent, type, properties, order)
    );
}

/**
 * Находит или создаёт год внутри «Завершённых задач»
 */
export function ensureYear(
    data: DataController,
    tx: ChangeScope,
    rootId: string,
    year: number,
): string {
    const date = `${pad(year, 4)}-01-01`;
    return ensureNode(
        data,
        tx,
        rootId,
        YEAR,
        (o) => o.properties.date === date,
        { date, name: String(year) },
        year,
    );
}

/**
 * Находит или создаёт месяц и день внутри `parentId` (корень или год); возвращает идентификатор дня
 */
export function ensureDay(
    data: DataController,
    tx: ChangeScope,
    parentId: string,
    date: Ymd,
): string {
    const monthDate = `${pad(date.year, 4)}-${pad(date.month)}-01`;
    const month = ensureNode(
        data,
        tx,
        parentId,
        MONTH,
        (o) => o.properties.date === monthDate,
        { date: monthDate, name: monthName(date) },
        date.year * 12 + date.month - 1,
    );
    const dayDate = `${monthDate.slice(0, 8)}${pad(date.day)}`;
    const existing = findChild(data, month, DAY_TYPES, (o) => o.properties.date === dayDate);
    if (existing) return existing.id;
    return createNode(
        tx,
        month,
        isWeekend(date) ? DAY_OFF : DAY,
        { date: dayDate, name: dayName(date) },
        date.day,
    );
}

/**
 * Находит категорию с таким названием внутри родителя или создаёт её
 */
export function ensureCategory(
    data: DataController,
    tx: ChangeScope,
    parent: string,
    name: string,
): string {
    return ensureNode(
        data,
        tx,
        parent,
        CATEGORY,
        (o) => o.properties.name === name,
        { name },
        CATEGORY_ORDER,
    );
}

/**
 * Предки объекта от ближайшего к корню
 *
 * @param data - контроллер данных
 * @param object - объект, чьих предков нужно найти
 * @returns цепочка родителей, начиная с непосредственного
 */
export function ancestors(data: DataController, object: DataObject): DataObject[] {
    const chain: DataObject[] = [];
    for (let id = object.parent; id;) {
        const parent = data.getObject(id);
        if (!parent) break;
        chain.push(parent);
        id = parent.parent;
    }
    return chain;
}

/**
 * Корень «Текущие задачи» или «Завершённые задачи» (`type`): рядом с объектом `near`
 * (в той же ветке «Задачи»), а без него или если ветки нет — среди всех корней «Задачи»
 */
export function findRoot(
    data: DataController,
    type: string,
    near?: DataObject,
): DataObject | undefined {
    const tasksRoot = near && ancestors(data, near).find((o) => o.type === TASKS_ROOT);
    const roots = tasksRoot
        ? [tasksRoot]
        : data.getChildren(null).filter((o) => o.type === TASKS_ROOT);
    return roots.flatMap((o) => data.getChildren(o.id)).find((o) => o.type === type);
}
