import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { deleteOfflineDb, openOfflineDb } from './offlineDb';

import type { PendingChangeset, StoreSnapshot } from '@platform/data/dataStore';

const snapshot = (seq: number, name = 'A'): StoreSnapshot => ({
    seq,
    types: [{ id: 'Note', name: 'Заметка' } as StoreSnapshot['types'][number]],
    objects: [{ id: 'a', type: 'Note', parent: null, number: 1, properties: { name } }],
});

const changeset = (id: string): PendingChangeset => ({
    id,
    operations: [{ op: 'update', id: 'a', changes: { name: { old: 'A', new: id } } }],
});

/**
 * Обёртка над IndexedDB: база пользователя со снимком, курсором и очередями вкладок
 */
describe('offlineDb', () => {
    /**
     * Проверяет, что снимок и очередь вкладки переживают закрытие и повторное открытие базы
     */
    it('save_snapshotAndQueue_surviveReopen', async () => {
        const indexedDB = new IDBFactory();
        const db = await openOfflineDb('u1', { indexedDB });
        await db.save('tab1', { snapshot: snapshot(5), queue: [changeset('c1')] });
        db.close();

        const reopened = await openOfflineDb('u1', { indexedDB });

        expect(await reopened.readSnapshot()).toEqual(snapshot(5));
        expect(await reopened.readQueues()).toEqual(new Map([['tab1', [changeset('c1')]]]));
        reopened.close();
    });

    /**
     * Проверяет, что снимок пишется, только если его курсор больше сохранённого
     */
    it('save_snapshotNotNewer_isIgnored', async () => {
        const db = await openOfflineDb('u1', { indexedDB: new IDBFactory() });
        await db.save('tab1', { snapshot: snapshot(5, 'new'), queue: [] });

        await db.save('tab2', { snapshot: snapshot(5, 'same'), queue: [] });
        await db.save('tab2', { snapshot: snapshot(3, 'old'), queue: [] });

        expect((await db.readSnapshot())?.objects[0].properties.name).toBe('new');
        await db.save('tab2', { snapshot: snapshot(6, 'newer'), queue: [] });
        expect((await db.readSnapshot())?.objects[0].properties.name).toBe('newer');
        db.close();
    });

    /**
     * Проверяет, что пустая очередь убирает запись вкладки
     */
    it('save_emptyQueue_removesTabRecord', async () => {
        const db = await openOfflineDb('u1', { indexedDB: new IDBFactory() });
        await db.save('tab1', { queue: [changeset('c1')] });

        await db.save('tab1', { queue: [] });

        expect(await db.readQueues()).toEqual(new Map());
        db.close();
    });

    /**
     * Проверяет, что подхват очереди другой вкладки убирает её запись и дописывает наборы к своей
     */
    it('adoptQueue_movesOtherTabQueueToOwnRecord', async () => {
        const db = await openOfflineDb('u1', { indexedDB: new IDBFactory() });
        await db.save('closed', { queue: [changeset('c1'), changeset('c2')] });
        await db.save('mine', { queue: [changeset('m1')] });

        const adopted = await db.adoptQueue('closed', 'mine');

        expect(adopted).toEqual([changeset('c1'), changeset('c2')]);
        expect(await db.readQueues()).toEqual(
            new Map([['mine', [changeset('m1'), changeset('c1'), changeset('c2')]]]),
        );
        expect(await db.adoptQueue('closed', 'mine')).toEqual([]);
        db.close();
    });

    /**
     * Проверяет, что базы разных пользователей не пересекаются
     */
    it('open_otherUser_hasOwnDatabase', async () => {
        const indexedDB = new IDBFactory();
        const first = await openOfflineDb('u1', { indexedDB });
        await first.save('tab1', { snapshot: snapshot(5), queue: [changeset('c1')] });

        const second = await openOfflineDb('u2', { indexedDB });

        expect(await second.readSnapshot()).toBeUndefined();
        expect(await second.readQueues()).toEqual(new Map());
        first.close();
        second.close();
    });

    /**
     * Проверяет произвольные значения (каталог расширений для старта без сети)
     */
    it('value_writeAndRead', async () => {
        const db = await openOfflineDb('u1', { indexedDB: new IDBFactory() });
        expect(await db.readValue('catalog')).toBeUndefined();

        await db.writeValue('catalog', [{ id: 'tasks', connected: true }]);

        expect(await db.readValue('catalog')).toEqual([{ id: 'tasks', connected: true }]);
        db.close();
    });

    /**
     * Проверяет, что удаление базы стирает всё, в том числе при открытом соединении другой вкладки
     */
    it('delete_removesEverything_evenWithOpenConnection', async () => {
        const indexedDB = new IDBFactory();
        const other = await openOfflineDb('u1', { indexedDB });
        await other.save('tab1', { snapshot: snapshot(5), queue: [changeset('c1')] });

        await deleteOfflineDb('u1', { indexedDB });

        const reopened = await openOfflineDb('u1', { indexedDB });
        expect(await reopened.readSnapshot()).toBeUndefined();
        expect(await reopened.readQueues()).toEqual(new Map());
        reopened.close();
    });
});
