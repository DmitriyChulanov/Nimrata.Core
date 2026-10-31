import { describe, expect, it } from 'vitest';

import { createFakeApi, postChangeset } from './fakeApi';

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
    number: 1,
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
        expect(
            await postChangeset(api, [create('r', 'Root', null), create('l', 'Leaf', 'r')]),
        ).toMatchObject({ status: 'applied' });
        expect(api.changesets).toHaveLength(1);
    });

    /**
     * Проверяет, что пустой список допустимых потомков запрещает любых потомков с кодом 422
     */
    it('fakeApi_emptyAllowedChildren_forbidsAnyChildren422', async () => {
        const api = createFakeApi(types);
        expect(
            await postChangeset(api, [create('l', 'Leaf', null), create('x', 'Leaf', 'l')]),
        ).toMatchObject({ status: 'rejected' });
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что тип вне списка отклоняется, а отсутствие поля не ограничивает
     */
    it('fakeApi_typeOutsideList_isRejectedAndMissingFieldDoesNotRestrict', async () => {
        const api = createFakeApi(types);
        expect(
            await postChangeset(api, [create('r', 'Root', null), create('f', 'Free', 'r')]),
        ).toMatchObject({ status: 'rejected' });
        expect(
            await postChangeset(api, [create('f', 'Free', null), create('r', 'Root', 'f')]),
        ).toMatchObject({ status: 'applied' });
        expect(api.changesets).toHaveLength(1);
    });

    /**
     * Проверяет, что перенос тоже проверяется с учётом объектов из прежних наборов
     */
    it('fakeApi_move_isCheckedToo_takingObjectsFromEarlierChangesetsIntoAccount', async () => {
        const api = createFakeApi(types, [
            { id: 'l', type: 'Leaf', parent: null, number: 1, properties: {} },
        ]);
        expect(await postChangeset(api, [create('f', 'Free', null)])).toMatchObject({
            status: 'applied',
        });
        expect(
            await postChangeset(api, [{ op: 'move', id: 'f', parent: { old: null, new: 'l' } }]),
        ).toMatchObject({ status: 'rejected' });
    });
});
