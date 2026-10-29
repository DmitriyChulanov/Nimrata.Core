import { describe, expect, it } from 'vitest';

import { objectLabel } from '../objectQueries/objectQueries';
import { createDataController } from './DataController';
import { createFakeApi } from './fakeApi';

const types = [
    {
        id: 'Item',
        name: 'Элемент',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'name', name: 'Имя', kind: 'string' }],
    },
    { id: 'Plain', name: 'Простой', extension: 't', extensionVersion: 1 },
];

async function setup() {
    const data = createDataController({ api: createFakeApi(types, []) });
    await data.load();
    return data;
}

/**
 * Контроллер данных: «Название» объектов, вычисляемое формирователем типа
 */
describe('DataController: titles', () => {
    /**
     * Проверяет, что у типа без формирователя название не определено и подпись берётся из имени
     */
    it('title_withoutFormatter_undefinedAndLabelFollowsName', async () => {
        const data = await setup();
        const created = await data.create({
            type: 'Item',
            parent: null,
            properties: { name: 'А' },
        });
        if (!created.ok) throw new Error(created.error);
        const item = data.getObject(created.id)!;

        expect(data.getTitle(item)).toBeUndefined();
        expect(objectLabel(data, item)).toBe('А');
    });

    /**
     * Проверяет, что формирователь типа задаёт подпись и следует за свойствами при чтении
     */
    it('title_withFormatter_labelIsComputedOnRead', async () => {
        const data = await setup();
        data.registerTitle('Item', (o) => `№ ${String(o.properties.name ?? '')}`);
        const created = await data.create({
            type: 'Item',
            parent: null,
            properties: { name: 'А' },
        });
        if (!created.ok) throw new Error(created.error);

        expect(objectLabel(data, data.getObject(created.id)!)).toBe('№ А');
        await data.setProperty(created.id, 'name', 'Б');
        expect(objectLabel(data, data.getObject(created.id)!)).toBe('№ Б');
    });

    /**
     * Проверяет, что формирователь действует только на свой тип
     */
    it('title_formatterOfOtherType_notApplied', async () => {
        const data = await setup();
        data.registerTitle('Item', () => 'чужое');
        const created = await data.create({ type: 'Plain', parent: null });
        if (!created.ok) throw new Error(created.error);

        expect(objectLabel(data, data.getObject(created.id)!)).toBe('Простой');
    });

    /**
     * Проверяет, что отписка снимает формирователь, а устаревшая отписка не снимает новый
     */
    it('title_unsubscribe_removesOnlyOwnFormatter', async () => {
        const data = await setup();
        const created = await data.create({
            type: 'Item',
            parent: null,
            properties: { name: 'А' },
        });
        if (!created.ok) throw new Error(created.error);
        const item = data.getObject(created.id)!;

        const offFirst = data.registerTitle('Item', () => 'первый');
        const offSecond = data.registerTitle('Item', () => 'второй');
        offFirst();
        expect(data.getTitle(item)).toBe('второй');
        offSecond();
        expect(data.getTitle(item)).toBeUndefined();
    });
});
