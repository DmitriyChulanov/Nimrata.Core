import { describe, expect, it } from 'vitest';

import { commonProperties, sortItems, titleProperty, toSections } from './gridModel';

import type { GridItem } from './gridModel';
import type { TypeDefinition } from '@platform/types/types';

const types = new Map<string, TypeDefinition>(
    [
        {
            id: 'A',
            name: 'А',
            extension: 't',
            extensionVersion: 1,
            properties: [
                { id: 'title', name: 'Название', kind: 'string' },
                { id: 'level', name: 'Уровень', kind: 'enum', values: [{ value: 'x', name: 'Х' }] },
                { id: 'only', name: 'Только А', kind: 'string' },
                { id: 'code', name: 'Код', kind: 'string' },
            ],
        },
        {
            id: 'B',
            name: 'Б',
            extension: 't',
            extensionVersion: 1,
            properties: [
                { id: 'title', name: 'Заголовок', kind: 'string' },
                { id: 'level', name: 'Уровень', kind: 'enum', values: [{ value: 'y', name: 'У' }] },
                { id: 'code', name: 'Код', kind: 'integer' },
            ],
        },
    ].map((t) => [t.id, t as TypeDefinition]),
);
const getType = (id: string) => types.get(id);

const object = (id: string, type: string, properties: Record<string, unknown>) => ({
    id,
    type,
    parent: null,
    number: 1,
    properties,
});

const property = (id: string, order?: number, category?: string): GridItem => ({
    kind: 'property',
    id,
    order,
    category,
    entry: { property: { id, name: id, kind: 'string' }, value: { mixed: false, value: null } },
});

const action = (id: string, order?: number, category?: string): GridItem => ({
    kind: 'action',
    id,
    order,
    category,
    action: { id, name: id },
    unavailable: null,
});

/**
 * Модель таблицы свойств: общие свойства группы
 */
describe('gridModel: commonProperties', () => {
    /**
     * Проверяет, что остаются свойства с одинаковыми идентификатором и видом, а значения сравниваются
     */
    it('commonProperties_groupOfTypes_keepsSameIdAndKindAndMarksDifferentValues', () => {
        const a = object('a', 'A', { title: 'Раз', level: 'x' });
        const b = object('b', 'B', { title: 'Два', level: 'y' });
        const c = object('c', 'A', { title: 'Раз', level: 'x' });

        const ids = commonProperties(a, [a, b], getType).map((e) => e.property.id);
        expect(ids).toEqual(['title']);

        const sameTypeSameValue = commonProperties(a, [a, c], getType);
        expect(sameTypeSameValue.find((e) => e.property.id === 'title')?.value).toEqual({
            mixed: false,
            value: 'Раз',
        });
        expect(commonProperties(a, [a, b], getType)[0]?.value).toEqual({ mixed: true });
    });

    /**
     * Проверяет, что свойство только для чтения хотя бы у одного объекта нередактируемо для группы
     */
    it('commonProperties_readOnlyInOneType_isReadOnlyForGroup', () => {
        const readOnly = new Map(types);
        readOnly.set('B', {
            ...types.get('B')!,
            properties: [{ id: 'title', name: 'Название', kind: 'string', readOnly: true }],
        });
        const a = object('a', 'A', {});
        const b = object('b', 'B', {});

        const [entry] = commonProperties(a, [a, b], (id) => readOnly.get(id));
        expect(entry?.property.readOnly).toBe(true);
    });
});

/**
 * Модель таблицы свойств: сквозной порядок и разделы
 */
describe('gridModel: sortItems and toSections', () => {
    /**
     * Проверяет, что строки с order идут по нему, остальные следом: свойства, затем действия
     */
    it('sortItems_mixedOrder_orderedFirstThenDeclarationOrder', () => {
        const sorted = sortItems([
            property('p1'),
            property('p2', 5),
            action('a1', 1),
            action('a2'),
            property('p3', 5),
        ]);

        expect(sorted.map((i) => i.id)).toEqual(['a1', 'p2', 'p3', 'p1', 'a2']);
    });

    /**
     * Проверяет, что заголовок вставляется при смене категории, а строки без категории в начале идут без него
     */
    it('toSections_categoryChange_insertsHeadersAndOtherAfterCategorized', () => {
        const sections = toSections([
            property('p1'),
            property('p2', undefined, 'Срок'),
            action('a1', undefined, 'Срок'),
            property('p3', undefined, 'Основное'),
            property('p4', undefined, 'Срок'),
            action('a2'),
        ]);

        expect(sections.map((s) => [s.category, s.items.map((i) => i.id)])).toEqual([
            [null, ['p1']],
            ['Срок', ['p2', 'a1']],
            ['Основное', ['p3']],
            ['Срок', ['p4']],
            ['Прочее', ['a2']],
        ]);
    });
});

/**
 * Модель таблицы свойств: виртуальное «Название»
 */
describe('gridModel: titleProperty', () => {
    const withName = new Map(types);
    withName.set('N', {
        id: 'N',
        name: 'Н',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'name', name: 'Имя', kind: 'string', category: 'Основное', order: 2 }],
    } as TypeDefinition);
    const typeOf = (id: string) => withName.get(id);

    /**
     * Проверяет, что без названия от формирователя строки нет
     */
    it('titleProperty_withoutFormatterTitle_returnsNull', () => {
        const a = object('1', 'N', {});

        expect(titleProperty(a, [a], () => undefined, typeOf)).toBeNull();
    });

    /**
     * Проверяет, что строка только для чтения и стоит сразу после «Имени»
     */
    it('titleProperty_withTitle_readOnlyRowAfterName', () => {
        const a = object('1', 'N', {});

        const row = titleProperty(a, [a], () => '09:00 — А', typeOf);

        expect(row?.property).toMatchObject({
            id: 'title',
            name: 'Название',
            readOnly: true,
            category: 'Основное',
            order: 2.5,
        });
        expect(row?.value).toEqual({ mixed: false, value: '09:00 — А' });
    });

    /**
     * Проверяет, что разные названия группы дают «Различны», а отсутствие у любого объекта скрывает строку
     */
    it('titleProperty_group_mixedOrHidden', () => {
        const [a, b] = [object('1', 'N', {}), object('2', 'N', {})];
        const byId = (o: { id: string }) => (o.id === '1' ? 'А' : 'Б');

        expect(titleProperty(a, [a, b], byId, typeOf)?.value).toEqual({ mixed: true });
        expect(
            titleProperty(a, [a, b], (o) => (o.id === '1' ? 'А' : undefined), typeOf),
        ).toBeNull();
    });
});
