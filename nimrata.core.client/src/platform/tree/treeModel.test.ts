import { describe, expect, it } from 'vitest';

import {
    branchesOf,
    childrenInOrder,
    collapseSubtrees,
    expandSubtrees,
    expandToReveal,
    flatten,
    hasChildren,
    visibleChildren,
} from './treeModel';
import { planNumberEdit } from './numbering';
import { planMove } from './planMove';

import type { DataObject } from '@platform/data/DataController';
import type { TypeDefinition } from '@platform/types/types';
import type { TreeReader } from './treeModel';

const types: Partial<TypeDefinition>[] = [
    { id: 'Folder', name: 'Папка', allowedChildren: ['Folder', 'Hidden'] },
    { id: 'Hidden', name: 'Механизм', hiddenInTree: true },
];

function obj(id: string, parent: string | null, number = 0, name?: string, type = 'Folder') {
    return {
        id,
        type,
        parent,
        number,
        properties: name === undefined ? {} : { name },
    } as DataObject;
}

/**
 * Читатель на литерале: потомки в порядке `number`, затем id, как отдаёт контроллер
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
                .sort((a, b) => a.number - b.number || (a.id < b.id ? -1 : 1)),
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
        obj('a', null, 1, 'А'),
        obj('b', null, 2, 'Б'),
        obj('c', null, 3, 'В'),
    ]);

    it('before_renumbersCollectionDensely', () => {
        const plan = planMove(reader, 'c', 'b', 'before');

        expect(plan).toEqual({
            ok: true,
            parent: null,
            changes: [
                { id: 'c', number: 2 },
                { id: 'b', number: 3 },
            ],
        });
    });

    it('afterLast_takesLastNumber', () => {
        const plan = planMove(reader, 'a', 'c', 'after');

        expect(plan).toEqual({
            ok: true,
            parent: null,
            changes: [
                { id: 'b', number: 1 },
                { id: 'c', number: 2 },
                { id: 'a', number: 3 },
            ],
        });
    });

    it('afterNodeWithEqualNumbers_staysDirectlyAfterIt', () => {
        const ties = readerOf([
            obj('x', null, 1, 'А'),
            obj('y', null, 1, 'Б'),
            obj('z', null, 1, 'В'),
            obj('m', null, 9, 'Я'),
        ]);

        const plan = planMove(ties, 'm', 'x', 'after');

        expect(plan).toEqual({
            ok: true,
            parent: null,
            changes: [
                { id: 'm', number: 2 },
                { id: 'y', number: 3 },
                { id: 'z', number: 4 },
            ],
        });
    });

    it('toAnotherParent_numbersTargetCollectionAndSetsParent', () => {
        const two = readerOf([
            obj('p', null, 1, 'П'),
            obj('q', 'p', 1, 'Ку'),
            obj('r', 'p', 2, 'Эр'),
            obj('m', null, 2, 'М'),
        ]);

        const plan = planMove(two, 'm', 'r', 'before');

        expect(plan).toEqual({
            ok: true,
            parent: 'p',
            changes: [
                { id: 'm', parent: 'p', number: 2 },
                { id: 'r', number: 3 },
            ],
        });
    });

    it('inside_putsLastWithMaxPlusOne', () => {
        const two = readerOf([
            obj('p', null, 1, 'П'),
            obj('q', 'p', 4, 'Ку'),
            obj('m', null, 2, 'М'),
        ]);

        const plan = planMove(two, 'm', 'p', 'inside');

        expect(plan).toEqual({
            ok: true,
            parent: 'p',
            changes: [{ id: 'm', parent: 'p', number: 5 }],
        });
    });

    it('sameSpot_rejected', () => {
        expect(planMove(reader, 'b', 'a', 'after')).toEqual({ ok: false });
    });

    it('intoSelfDescendant_rejected', () => {
        const nested = readerOf([obj('r', null), obj('k', 'r')]);

        expect(planMove(nested, 'r', 'k', 'inside')).toEqual({ ok: false });
    });

    it('insideDisallowedType_rejected', () => {
        const flat = readerOf([obj('h', null, 1, undefined, 'Hidden'), obj('x', null, 2)]);

        expect(planMove(flat, 'x', 'h', 'inside')).toEqual({ ok: false });
    });
});

describe('planNumberEdit', () => {
    const reader = readerOf([
        obj('a', null, 1, 'А'),
        obj('b', null, 2, 'Б'),
        obj('c', null, 3, 'В'),
    ]);

    it('occupiedNumber_shiftsNeighboursFromIt', () => {
        const changes = planNumberEdit(reader, reader.getObject('c')!, 2);

        expect(changes).toEqual([
            { id: 'c', number: 2 },
            { id: 'b', number: 3 },
        ]);
    });

    it('freeNumber_justSetsIt', () => {
        const changes = planNumberEdit(reader, reader.getObject('a')!, 10);

        expect(changes).toEqual([{ id: 'a', number: 10 }]);
    });

    it('sameNumber_nothingToDo', () => {
        expect(planNumberEdit(reader, reader.getObject('a')!, 1)).toEqual([]);
    });
});

describe('свернуть и развернуть', () => {
    const reader = readerOf([
        obj('r', null, 1, 'Р'),
        obj('a', 'r', 1, 'А'),
        obj('aa', 'a', 1, 'АА'),
        obj('b', 'r', 2, 'Б'),
    ]);

    it('expandSubtrees_opensWholeHierarchyOfSelected', () => {
        const next = expandSubtrees(reader, new Set(), ['r']);

        expect([...next].sort()).toEqual(['a', 'r']);
    });

    it('collapseSubtrees_closesSelectedAndDescendantsOnly', () => {
        const next = collapseSubtrees(reader, new Set(['r', 'a', 'other']), ['a']);

        expect([...next].sort()).toEqual(['other', 'r']);
    });

    it('leaf_hasNoBranches', () => {
        expect(branchesOf(reader, ['b'])).toEqual([]);
    });
});
