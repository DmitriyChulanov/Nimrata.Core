import { describe, expect, it } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { createFakeApi } from '@platform/data/fakeApi';

import { copySubtrees, topLevelIds } from './clipboard';

const types = [
    {
        id: 'Folder',
        name: 'Папка',
        extension: 't',
        extensionVersion: 1,
        allowedChildren: ['Folder', 'Hidden'],
    },
    { id: 'Hidden', name: 'Механизм', extension: 't', extensionVersion: 1, hiddenInTree: true },
];

function obj(id: string, type: string, parent: string | null, number: number, name?: string) {
    return { id, type, parent, number, properties: name === undefined ? {} : { name } };
}

async function load(objects: unknown[]) {
    const controller = createDataController({ api: createFakeApi(types, objects) });
    await controller.load();
    return controller;
}

/**
 * Порядок буфера обмена и удаления: совпадает с порядком строк в дереве
 */
describe('clipboard: порядок', () => {
    /**
     * Проверяет, что при равном `number` порядок выбирается по названию, как в дереве, а не по id
     */
    it('topLevelIds_equalOrder_followsVisibleTitleOrder', async () => {
        // В дереве «Арбуз» (id b) идёт перед «Яблоком» (id a): при равном number решает название
        const data = await load([
            obj('a', 'Folder', null, 0, 'Яблоко'),
            obj('b', 'Folder', null, 0, 'Арбуз'),
        ]);

        expect(topLevelIds(data, ['a', 'b'])).toEqual(['b', 'a']);
    });

    /**
     * Проверяет порядок снимков потомков при равном `number`; скрытый объект копируется как раньше
     */
    it('copySubtrees_equalOrder_followsVisibleOrder_andKeepsHiddenChildren', async () => {
        const data = await load([
            obj('r', 'Folder', null, 0, 'Корень'),
            obj('a', 'Folder', 'r', 0, 'Яблоко'),
            obj('b', 'Folder', 'r', 0, 'Арбуз'),
            obj('h', 'Hidden', 'r', 0),
        ]);

        const [root] = copySubtrees(data, ['r']);

        expect(root.children.filter((c) => c.type === 'Folder').map((c) => c.sourceId)).toEqual([
            'b',
            'a',
        ]);
        expect(root.children.some((c) => c.sourceId === 'h')).toBe(true);
    });

    /**
     * Проверяет, что вложенный выделенный объект и несуществующий id не попадают в верхние
     */
    it('topLevelIds_descendantSelected_dropped', async () => {
        const data = await load([
            obj('r', 'Folder', null, 0, 'Р'),
            obj('c', 'Folder', 'r', 0, 'К'),
        ]);

        expect(topLevelIds(data, ['c', 'r', 'нет'])).toEqual(['r']);
    });
});
