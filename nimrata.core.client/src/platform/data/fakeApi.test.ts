import { describe, expect, it } from 'vitest';

import { createFakeApi } from './fakeApi';

const types = [
    { id: 'Root', name: 'Корень', allowedChildren: ['Leaf'] },
    { id: 'Leaf', name: 'Лист', allowedChildren: [] },
    { id: 'Free', name: 'Свободный' },
];

const create = (id: string, type: string, parent: string | null) => ({
    op: 'create',
    id,
    type,
    parent,
    order: 0,
    properties: {},
});

/**
 * Подставной API: допустимость родителя как на сервере
 */
describe('fakeApi: parent allowance like on the server', () => {
    /**
     * Проверяет, что тип из списка допустимых потомков и любой тип в корне принимаются
     */
    it('fakeApi_typeFromAllowedChildrenAndAnyTypeAtRoot_isAccepted', async () => {
        const api = createFakeApi(types);
        await api.post('changesets', {
            operations: [create('r', 'Root', null), create('l', 'Leaf', 'r')],
        });
        expect(api.changesets).toHaveLength(1);
    });

    /**
     * Проверяет, что пустой список допустимых потомков запрещает любых потомков с кодом 422
     */
    it('fakeApi_emptyAllowedChildren_forbidsAnyChildren422', async () => {
        const api = createFakeApi(types);
        await expect(
            api.post('changesets', {
                operations: [create('l', 'Leaf', null), create('x', 'Leaf', 'l')],
            }),
        ).rejects.toMatchObject({ status: 422 });
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что тип вне списка отклоняется, а отсутствие поля не ограничивает
     */
    it('fakeApi_typeOutsideList_isRejectedAndMissingFieldDoesNotRestrict', async () => {
        const api = createFakeApi(types);
        await expect(
            api.post('changesets', {
                operations: [create('r', 'Root', null), create('f', 'Free', 'r')],
            }),
        ).rejects.toMatchObject({ status: 422 });
        await api.post('changesets', {
            operations: [create('f', 'Free', null), create('r', 'Root', 'f')],
        });
        expect(api.changesets).toHaveLength(1);
    });

    /**
     * Проверяет, что перенос тоже проверяется с учётом объектов из прежних наборов
     */
    it('fakeApi_move_isCheckedToo_takingObjectsFromEarlierChangesetsIntoAccount', async () => {
        const api = createFakeApi(types, [
            { id: 'l', type: 'Leaf', parent: null, order: 0, properties: {} },
        ]);
        await api.post('changesets', { operations: [create('f', 'Free', null)] });
        await expect(
            api.post('changesets', {
                operations: [{ op: 'move', id: 'f', parent: { old: null, new: 'l' } }],
            }),
        ).rejects.toMatchObject({ status: 422 });
    });
});
