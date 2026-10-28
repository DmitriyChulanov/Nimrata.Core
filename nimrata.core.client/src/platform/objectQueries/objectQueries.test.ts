import { describe, expect, it } from 'vitest';

import { ancestors, objectLabel } from './objectQueries';

import type { DataObject } from '../data/DataController';
import type { TypeDefinition } from '../types/types';
import type { ObjectReader } from './objectQueries';

function obj(id: string, parent: string | null, properties: DataObject['properties'] = {}) {
    return { id, type: 'folder', parent, order: 0, properties } as DataObject;
}

function readerOf(objects: DataObject[], types: Partial<TypeDefinition>[] = []): ObjectReader {
    const o = new Map(objects.map((x) => [x.id, x]));
    const t = new Map(types.map((x) => [x.id!, x as TypeDefinition]));
    return { getObject: (id) => o.get(id), getType: (id) => t.get(id) };
}

describe('objectLabel', () => {
    const types = [{ id: 'folder', name: 'Папка' }];

    it('берёт name', () => {
        const a = obj('a', null, { name: 'Дом' });
        expect(objectLabel(readerOf([a], types), a)).toBe('Дом');
    });

    it('без name берёт название типа', () => {
        const a = obj('a', null);
        expect(objectLabel(readerOf([a], types), a)).toBe('Папка');
    });

    it('пустой name считается отсутствующим', () => {
        const a = obj('a', null, { name: '' });
        expect(objectLabel(readerOf([a], types), a)).toBe('Папка');
    });

    it('title в подписи не участвует', () => {
        const a = obj('a', null, { title: 'Заголовок' });
        expect(objectLabel(readerOf([a], types), a)).toBe('Папка');
    });

    it('без типа возвращает идентификатор типа', () => {
        const a = obj('a', null);
        expect(objectLabel(readerOf([a]), a)).toBe('folder');
    });
});

describe('ancestors', () => {
    it('идёт от ближайшего родителя к корню', () => {
        const [r, m, l] = [obj('r', null), obj('m', 'r'), obj('l', 'm')];
        expect(ancestors(readerOf([r, m, l]), l).map((o) => o.id)).toEqual(['m', 'r']);
    });

    it('у корня предков нет', () => {
        const r = obj('r', null);
        expect(ancestors(readerOf([r]), r)).toEqual([]);
    });

    it('обрывается на отсутствующем родителе', () => {
        const l = obj('l', 'нет');
        expect(ancestors(readerOf([l]), l)).toEqual([]);
        const m = obj('m', 'нет');
        const c = obj('c', 'm');
        expect(ancestors(readerOf([m, c]), c).map((o) => o.id)).toEqual(['m']);
    });

    it('защищён от цикла', () => {
        const a = obj('a', 'b');
        const b = obj('b', 'a');
        expect(ancestors(readerOf([a, b]), a).map((o) => o.id)).toEqual(['b']);
    });
});
