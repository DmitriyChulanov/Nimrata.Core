import { describe, expect, it } from 'vitest';

import { childrenInOrder, expandToReveal, flatten, hasChildren, visibleChildren } from './treeModel';
import { planMove } from './planMove';

import type { DataController, DataObject } from '@platform/data/DataController';
import type { TypeDefinition } from '@platform/types/types';
import type { TreeReader } from './treeModel';

const types: Partial<TypeDefinition>[] = [
    { id: 'Folder', name: 'Папка', allowedChildren: ['Folder', 'Hidden'] },
    { id: 'Hidden', name: 'Механизм', hiddenInTree: true },
];

function obj(id: string, parent: string | null, order = 0, name?: string, type = 'Folder') {
    return {
        id,
        type,
        parent,
        order,
        properties: name === undefined ? {} : { name },
    } as DataObject;
}

/**
 * Читатель на литерале: потомки в порядке `order`, затем id, как отдаёт контроллер
 */
function readerOf(objects: DataObject[]): TreeReader {
    const o = new Map(objects.map((x) => [x.id, x]));
    const t = new Map(types.map((x) => [x.id!, x as TypeDefinition]));
    return {
        getObject: (id) => o.get(id),
        getType: (id) => t.get(id),
        getChildren: (parent) =>
            objects
                .filter((x) => x.parent === parent)
                .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)),
    };
}

const ids = (list: { object: DataObject }[]) => list.map((n) => n.object.id);

describe('treeModel: порядок потомков', () => {
    it('visibleChildren_sortsByOrderThenTitleThenId', () => {
        const reader = readerOf([
            obj('z', null, 1, 'Аа'),
            obj('c', null, 0, 'Яблоко'),
            obj('b', null, 0, 'Арбуз'),
            obj('d', null, 0, 'Арбуз'),
        ]);

        expect(ids(visibleChildren(reader, null))).toEqual(['b', 'd', 'c', 'z']);
    });

    it('visibleChildren_hidesHiddenInTreeTypes_childrenInOrderKeepsThem', () => {
        const reader = readerOf([obj('a', null, 0, 'А'), obj('h', null, 0, undefined, 'Hidden')]);

        expect(ids(visibleChildren(reader, null))).toEqual(['a']);
        expect(childrenInOrder(reader, null).map((o) => o.id)).toEqual(['a', 'h']);
    });

    it('hasChildren_countsOnlyVisible', () => {
        const reader = readerOf([
            obj('r', null),
            obj('h', 'r', 0, undefined, 'Hidden'),
            obj('l', null),
            obj('c', 'l'),
        ]);

        expect(hasChildren(reader, 'r')).toBe(false);
        expect(hasChildren(reader, 'l')).toBe(true);
    });
});

describe('treeModel: flatten', () => {
    const reader = readerOf([
        obj('r', null, 0, 'Корень'),
        obj('a', 'r', 0, 'Дочь'),
        obj('aa', 'a', 0, 'Внучка'),
        obj('s', null, 1, 'Сосед'),
    ]);

    it('collapsed_showsOnlyRoots', () => {
        const rows = flatten(reader, new Set());

        expect(rows.map((r) => [r.object.id, r.level, r.hasChildren])).toEqual([
            ['r', 1, true],
            ['s', 1, false],
        ]);
    });

    it('expanded_descendsWithLevels', () => {
        const rows = flatten(reader, new Set(['r', 'a']));

        expect(rows.map((r) => [r.object.id, r.title, r.level])).toEqual([
            ['r', 'Корень', 1],
            ['a', 'Дочь', 2],
            ['aa', 'Внучка', 3],
            ['s', 'Сосед', 1],
        ]);
    });
});

describe('treeModel: expandToReveal', () => {
    const reader = readerOf([obj('r', null), obj('a', 'r'), obj('aa', 'a')]);

    it('addsAncestorsOfTarget', () => {
        const next = expandToReveal(reader, new Set(['x']), 'aa');

        expect([...next].sort()).toEqual(['a', 'r', 'x']);
    });

    it('nothingToAdd_returnsSameSet', () => {
        const expanded = new Set(['r', 'a']);

        expect(expandToReveal(reader, expanded, 'aa')).toBe(expanded);
        expect(expandToReveal(reader, expanded, 'r')).toBe(expanded);
        expect(expandToReveal(reader, expanded, 'нет')).toBe(expanded);
    });
});

describe('planMove на литерале читателя', () => {
    const reader = readerOf([
        obj('a', null, 0, 'А'),
        obj('b', null, 1, 'Б'),
        obj('c', null, 2, 'В'),
    ]);
    const data = reader as unknown as DataController;
    const siblings = (parent: string | null) =>
        visibleChildren(reader, parent).map((n) => n.object);

    it('before_putsBetweenNeighbours', () => {
        const plan = planMove(data, siblings, 'c', 'b', 'before');

        expect(plan).toEqual({ ok: true, parent: null, order: 0.5 });
    });

    it('afterLast_takesNextOrder', () => {
        const plan = planMove(data, siblings, 'a', 'c', 'after');

        expect(plan).toEqual({ ok: true, parent: null, order: 3 });
    });

    it('intoSelfDescendant_rejected', () => {
        const nested = readerOf([obj('r', null), obj('k', 'r')]);

        const plan = planMove(
            nested as unknown as DataController,
            (p) => visibleChildren(nested, p).map((n) => n.object),
            'r',
            'k',
            'inside',
        );

        expect(plan).toEqual({ ok: false });
    });

    it('insideDisallowedType_rejected', () => {
        const flat = readerOf([obj('h', null, 0, undefined, 'Hidden'), obj('x', null, 1)]);

        const plan = planMove(
            flat as unknown as DataController,
            (p) => visibleChildren(flat, p).map((n) => n.object),
            'x',
            'h',
            'inside',
        );

        expect(plan).toEqual({ ok: false });
    });
});
