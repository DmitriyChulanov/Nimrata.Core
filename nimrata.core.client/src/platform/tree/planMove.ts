import { ancestors } from '@platform/objectQueries/objectQueries';

import { nextNumber, planInsertion } from './numbering';
import { childrenInOrder } from './treeModel';

import type { NumberChange } from './numbering';
import type { TreeReader } from './treeModel';

/**
 * Куда относительно целевого узла опускается переносимый: перед ним, внутрь или после него
 */
export type DropPosition = 'before' | 'inside' | 'after';

/**
 * План переноса: допустим ли он и какие изменения родителя и номеров он даёт
 */
export type MovePlan = { ok: true; parent: string | null; changes: NumberChange[] } | { ok: false };

/**
 * Планирует перенос узла: допустим ли он, какой родитель у него будет и как изменятся номера.
 * «До»/«после» узла перенумеровывают целевую коллекцию плотно (1..N), «внутрь» ставит узел последним.
 * Корень принимает любые типы; у остальных родителей тип должен входить в `allowedChildren`
 */
export function planMove(
    data: TreeReader,
    dragId: string,
    targetId: string,
    position: DropPosition,
): MovePlan {
    const dragged = data.getObject(dragId);
    const target = data.getObject(targetId);
    if (!dragged || !target || dragId === targetId) return { ok: false };

    const parent = position === 'inside' ? target.id : target.parent;

    // Нельзя переносить узел в самого себя и в собственного потомка
    const parentObject = parent === null ? undefined : data.getObject(parent);
    if (
        parent === dragId ||
        (parentObject && ancestors(data, parentObject).some((o) => o.id === dragId))
    ) {
        return { ok: false };
    }
    if (parent !== null) {
        const parentType = data.getType(data.getObject(parent)?.type ?? '');
        if (!parentType?.allowedChildren?.includes(dragged.type)) return { ok: false };
    }

    const all = childrenInOrder(data, parent);
    const others = all.filter((o) => o.id !== dragId);
    const index =
        position === 'inside'
            ? others.length
            : others.findIndex((o) => o.id === target.id) + (position === 'after' ? 1 : 0);

    // Узел и так стоит на этом месте этой коллекции
    if (parent === dragged.parent && all[index]?.id === dragId) return { ok: false };

    const changes =
        position === 'inside'
            ? [{ id: dragId, parent, number: nextNumber(others) }]
            : planInsertion(dragged, parent, others, index);
    if (changes.length === 0) return { ok: false };
    return { ok: true, parent, changes };
}

/**
 * Положение указателя в строке высотой `height`: верхняя и нижняя четверти — «перед»/«после»
 */
export function positionInRow(offsetY: number, height: number): DropPosition {
    if (offsetY < height / 4) return 'before';
    if (offsetY > (height * 3) / 4) return 'after';
    return 'inside';
}
