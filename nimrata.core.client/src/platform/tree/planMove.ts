import type { DataController, DataObject } from '../data/DataController';

/** Куда относительно целевого узла опускается переносимый: перед ним, внутрь или после него. */
export type DropPosition = 'before' | 'inside' | 'after';

export type MovePlan = { ok: true; parent: string | null; order: number } | { ok: false };

/**
 * Планирует перенос узла: допустим ли он и какие родитель и порядок получит узел.
 * `siblings` отдаёт видимых потомков родителя в порядке показа (как их видит пользователь).
 * Корень принимает любые типы; у остальных родителей тип должен входить в `allowedChildren`.
 */
export function planMove(
    data: DataController,
    siblings: (parent: string | null) => DataObject[],
    dragId: string,
    targetId: string,
    position: DropPosition,
): MovePlan {
    const dragged = data.getObject(dragId);
    const target = data.getObject(targetId);
    if (!dragged || !target || dragId === targetId) return { ok: false };

    const parent = position === 'inside' ? target.id : target.parent;

    // Нельзя переносить узел в самого себя и в собственного потомка.
    for (let p: string | null = parent; p !== null; p = data.getObject(p)?.parent ?? null) {
        if (p === dragId) return { ok: false };
    }
    if (parent !== null) {
        const parentType = data.getType(data.getObject(parent)?.type ?? '');
        if (!parentType?.allowedChildren?.includes(dragged.type)) return { ok: false };
    }

    const others = siblings(parent).filter((o) => o.id !== dragId);
    const index =
        position === 'inside'
            ? others.length
            : others.findIndex((o) => o.id === target.id) + (position === 'after' ? 1 : 0);
    const previous = others[index - 1];
    const next = others[index];
    const order =
        previous && next
            ? (previous.order + next.order) / 2
            : previous
              ? previous.order + 1
              : next
                ? next.order - 1
                : 0;

    if (parent === dragged.parent && order === dragged.order) return { ok: false };
    return { ok: true, parent, order };
}

/** Положение указателя в строке высотой `height`: верхняя и нижняя четверти — «перед»/«после». */
export function positionInRow(offsetY: number, height: number): DropPosition {
    if (offsetY < height / 4) return 'before';
    if (offsetY > (height * 3) / 4) return 'after';
    return 'inside';
}
