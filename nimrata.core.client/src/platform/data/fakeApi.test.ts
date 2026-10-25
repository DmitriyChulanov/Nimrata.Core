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

describe('fakeApi: допустимость родителя как на сервере', () => {
    it('принимает тип из allowedChildren и любой тип в корне', async () => {
        const api = createFakeApi(types);
        await api.post('changesets', {
            operations: [create('r', 'Root', null), create('l', 'Leaf', 'r')],
        });
        expect(api.changesets).toHaveLength(1);
    });

    it('пустой список allowedChildren запрещает любых потомков (422)', async () => {
        const api = createFakeApi(types);
        await expect(
            api.post('changesets', {
                operations: [create('l', 'Leaf', null), create('x', 'Leaf', 'l')],
            }),
        ).rejects.toMatchObject({ status: 422 });
        expect(api.changesets).toHaveLength(0);
    });

    it('тип вне списка отклоняется, а отсутствие поля не ограничивает', async () => {
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

    it('проверяет и перенос, учитывая объекты из прежних наборов', async () => {
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
