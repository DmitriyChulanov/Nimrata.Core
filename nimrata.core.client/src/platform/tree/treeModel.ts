import { collator } from '@platform/collator';
import { ancestors, objectLabel } from '@platform/objectQueries/objectQueries';

import type { DataObject } from '@platform/data/DataController';
import type { ObjectReader } from '@platform/objectQueries/objectQueries';

/**
 * Узкий доступ к дереву: читатель объектов плюс потомки родителя (`DataController` подходит как есть)
 */
export interface TreeReader extends ObjectReader {
    /** Потомки родителя; `null` — корень */
    getChildren(parent: string | null): DataObject[];
}

/**
 * Узел дерева с готовым названием
 */
export interface TreeNode {
    /** Объект узла */
    object: DataObject;
    /** Название объекта для показа и сортировки */
    title: string;
}

/**
 * Строка плоского списка дерева
 */
export interface TreeRow extends TreeNode {
    /** Уровень вложенности; корень — 1 */
    level: number;
    /** Есть ли видимые потомки */
    hasChildren: boolean;
}

/**
 * Потомки родителя в порядке дерева, включая скрытые в дереве типы:
 * по `order`, затем по названию (collator `ru`), затем по идентификатору
 *
 * @param reader - доступ к дереву
 * @param parent - идентификатор родителя; `null` — корень
 * @returns узлы с названиями
 */
function sortedNodes(reader: TreeReader, parent: string | null): TreeNode[] {
    return reader
        .getChildren(parent)
        .map((object) => ({ object, title: objectLabel(reader, object) }))
        .sort(
            (a, b) =>
                a.object.order - b.object.order ||
                collator.compare(a.title, b.title) ||
                (a.object.id < b.object.id ? -1 : 1),
        );
}

/**
 * Потомки родителя в порядке дерева, в том числе скрытые в дереве (для буфера обмена и удаления)
 *
 * @param reader - доступ к дереву
 * @param parent - идентификатор родителя; `null` — корень
 * @returns объекты по порядку дерева
 */
export function childrenInOrder(reader: TreeReader, parent: string | null): DataObject[] {
    return sortedNodes(reader, parent).map((n) => n.object);
}

/**
 * Видимые потомки родителя: без типов с `hiddenInTree`, в порядке дерева
 *
 * @param reader - доступ к дереву
 * @param parent - идентификатор родителя; `null` — корень
 * @returns узлы с названиями
 */
export function visibleChildren(reader: TreeReader, parent: string | null): TreeNode[] {
    return sortedNodes(reader, parent).filter((n) => !reader.getType(n.object.type)?.hiddenInTree);
}

/**
 * Есть ли у объекта видимые потомки (без сортировки)
 *
 * @param reader - доступ к дереву
 * @param id - идентификатор объекта
 * @returns `true`, если виден хотя бы один потомок
 */
export function hasChildren(reader: TreeReader, id: string): boolean {
    return reader.getChildren(id).some((o) => !reader.getType(o.type)?.hiddenInTree);
}

/**
 * Разворачивает дерево в плоский список видимых строк
 *
 * @param reader - доступ к дереву
 * @param expanded - идентификаторы раскрытых узлов
 * @returns строки по порядку показа
 */
export function flatten(reader: TreeReader, expanded: ReadonlySet<string>): TreeRow[] {
    const rows: TreeRow[] = [];
    const walk = (parent: string | null, level: number) => {
        for (const node of visibleChildren(reader, parent)) {
            const withChildren = hasChildren(reader, node.object.id);
            rows.push({ ...node, level, hasChildren: withChildren });
            if (withChildren && expanded.has(node.object.id)) walk(node.object.id, level + 1);
        }
    };
    walk(null, 1);
    return rows;
}

/**
 * Раскрытые узлы с предками объекта: чтобы строка объекта оказалась в списке
 *
 * @param reader - доступ к дереву
 * @param expanded - уже раскрытые узлы
 * @param id - объект, к которому переходят
 * @returns то же множество, если добавлять нечего, иначе новое
 */
export function expandToReveal(
    reader: TreeReader,
    expanded: ReadonlySet<string>,
    id: string,
): ReadonlySet<string> {
    const object = reader.getObject(id);
    const missing = object ? ancestors(reader, object).filter((o) => !expanded.has(o.id)) : [];
    if (missing.length === 0) return expanded;
    return new Set([...expanded, ...missing.map((o) => o.id)]);
}
