import type { ChangeResult, ChangeScope, DataController } from '@platform/data/DataController';

/**
 * Снимок скопированного узла вместе с потомками
 */
export interface ClipboardNode {
    /** Идентификатор исходного объекта: по нему ссылки внутри копии перенаправляются на копии */
    sourceId: string;
    type: string;
    properties: Record<string, unknown>;
    children: ClipboardNode[];
}

/**
 * Идентификаторы выделенных объектов без тех, у кого выделен предок, — в порядке дерева
 *
 * @param data - контроллер данных
 * @param ids - выделенные объекты
 * @returns верхние объекты поддеревьев; несуществующие пропускаются
 */
export function topLevelIds(data: DataController, ids: readonly string[]): string[] {
    const chosen = new Set(ids.filter((id) => data.getObject(id)));
    const top = [...chosen].filter((id) => {
        for (let p = data.getObject(id)?.parent; p; p = data.getObject(p)?.parent) {
            if (chosen.has(p)) return false;
        }
        return true;
    });
    const order = new Map<string, number>();
    const walk = (parent: string | null) => {
        for (const child of data.getChildren(parent)) {
            order.set(child.id, order.size);
            walk(child.id);
        }
    };
    walk(null);
    return top.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * Снимок поддеревьев выделенных объектов (потомки — все, в том числе скрытые в дереве)
 *
 * @param data - контроллер данных
 * @param ids - выделенные объекты
 * @returns снимки верхних объектов по порядку дерева
 */
export function copySubtrees(data: DataController, ids: readonly string[]): ClipboardNode[] {
    const snapshot = (id: string): ClipboardNode => {
        const object = data.getObject(id)!;
        return {
            sourceId: id,
            type: object.type,
            properties: structuredClone(object.properties),
            children: data.getChildren(id).map((c) => snapshot(c.id)),
        };
    };
    return topLevelIds(data, ids).map(snapshot);
}

/**
 * Можно ли вставить снимки под объект: тип каждого скопированного корня допустим у типа цели
 *
 * @param data - контроллер данных
 * @param nodes - скопированные корни
 * @param targetId - объект, под который вставляют
 * @returns `true`, если вставка возможна
 */
export function canPaste(
    data: DataController,
    nodes: readonly ClipboardNode[],
    targetId: string,
): boolean {
    const target = data.getObject(targetId);
    if (!target || nodes.length === 0) return false;
    const allowed = data.getType(target.type)?.allowedChildren ?? [];
    return nodes.every((n) => allowed.includes(n.type));
}

/**
 * Вставляет снимки потомками объекта одним набором. Объекты получают новые идентификаторы;
 * ссылки между копиями перенаправляются на копии, ссылки на прочие объекты остаются
 *
 * @param data - контроллер данных
 * @param nodes - скопированные корни
 * @param targetId - родитель вставки; копии добавляются последними
 * @returns идентификаторы созданных корней либо причина отказа
 */
export async function pasteSubtrees(
    data: DataController,
    nodes: readonly ClipboardNode[],
    targetId: string,
): Promise<{ ok: true; ids: string[] } | Extract<ChangeResult, { ok: false }>> {
    const ids: string[] = [];
    const result = await data.perform(
        (tx: ChangeScope) => {
            const copies = new Map<string, string>();
            const references: { id: string; property: string; value: string }[] = [];

            const create = (node: ClipboardNode, parent: string): string => {
                const referenceIds = new Set(
                    (data.getType(node.type)?.properties ?? [])
                        .filter((p) => p.kind === 'reference')
                        .map((p) => p.id),
                );
                const properties: Record<string, unknown> = {};
                const deferred: { property: string; value: string }[] = [];
                for (const [property, value] of Object.entries(node.properties)) {
                    if (referenceIds.has(property) && typeof value === 'string') {
                        deferred.push({ property, value });
                    } else {
                        properties[property] = value;
                    }
                }
                const created = tx.create({ type: node.type, parent, properties });
                if (!created.ok) throw new Error(created.error);
                copies.set(node.sourceId, created.id);
                for (const d of deferred) references.push({ id: created.id, ...d });
                for (const child of node.children) create(child, created.id);
                return created.id;
            };

            for (const node of nodes) ids.push(create(node, targetId));

            // Ссылки ставятся после создания всех копий: цель ссылки может оказаться позже в порядке обхода
            for (const { id, property, value } of references) {
                const set = tx.setProperty(id, property, copies.get(value) ?? value);
                if (!set.ok) throw new Error(set.error);
            }
        },
        // Копия уже содержит всё состояние исходного поддерева, хуки создания второй раз не нужны
        { hooks: false },
    );
    return result.ok ? { ok: true, ids } : result;
}
