import { describe, expect, it } from 'vitest';

import { createDataController } from './DataController';
import { createFakeApi } from './fakeApi';

const types = [
    {
        id: 'Item',
        name: 'Элемент',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'link', name: 'Ссылка', kind: 'string' }],
        actions: [{ id: 'open', name: 'Открыть', placements: ['propertyGrid'] }],
    },
];

const objects = [
    { id: 'a', type: 'Item', parent: null, number: 0, properties: { link: 'https://x.test' } },
    { id: 'b', type: 'Item', parent: null, number: 1, properties: {} },
];

/**
 * Контроллер данных: условие доступности действия
 */
describe('DataController: action availability condition', () => {
    /**
     * Проверяет, что действие с условием показывается только там, где оно выполняется, и не запускается иначе
     */
    it('availability_actionWithCondition_shownOnlyWhereConditionHoldsAndNotRunOtherwise', async () => {
        const data = createDataController({ api: createFakeApi(types, objects) });
        await data.load();
        let opened = 0;
        data.registerAction(
            'Item',
            'open',
            () => {
                opened += 1;
            },
            { available: (object) => typeof object.properties.link === 'string' },
        );

        expect(data.getActions('a', 'propertyGrid').map((a) => a.id)).toEqual(['open']);
        expect(data.getActions('b', 'propertyGrid')).toEqual([]);

        expect((await data.runAction('b', 'open')).ok).toBe(false);
        expect(opened).toBe(0);
        expect((await data.runAction('a', 'open')).ok).toBe(true);
        expect(opened).toBe(1);

        await data.setProperty('b', 'link', 'https://y.test');
        expect(data.getActions('b', 'propertyGrid').map((a) => a.id)).toEqual(['open']);
    });
});
