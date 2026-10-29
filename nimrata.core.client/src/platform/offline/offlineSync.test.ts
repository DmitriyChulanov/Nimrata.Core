import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { createFakeApi, whenSynced } from '@platform/data/fakeApi';

import { openOfflineDb } from './offlineDb';
import { createOfflineSync } from './offlineSync';
import { createMemoryLocks } from './tabLocks';

import type { ApiClient } from '@platform/api/apiClient';
import type { DataController } from '@platform/data/DataController';
import type { OfflineSync } from './offlineSync';
import type { TabLocks } from './tabLocks';

const types = [
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'name', name: 'Имя', kind: 'string' }],
    },
];

const objects = [{ id: 'a', type: 'Note', parent: null, number: 1, properties: { name: 'A' } }];

/**
 * API без сети: каждый запрос падает сетевой ошибкой
 */
function offlineApi(): ApiClient {
    const fail = () => Promise.reject(new TypeError('Failed to fetch'));
    return { get: fail, post: fail, put: fail, delete: fail };
}

/**
 * Общая для «вкладок» среда: одна IndexedDB и одни блокировки
 */
function browser() {
    return { indexedDB: new IDBFactory(), locks: createMemoryLocks() };
}

/**
 * Открытая «вкладка»: контроллер и его офлайн-часть; всё закрывается в `afterEach`
 */
const opened: { data: DataController; offline: OfflineSync }[] = [];

function openTab(
    env: { indexedDB: IDBFactory; locks: TabLocks },
    api: ApiClient,
    tabId: string,
    adoptIntervalMs?: number,
) {
    const data = createDataController({ api });
    const offline = createOfflineSync({
        controller: data,
        userId: 'u1',
        tabId,
        indexedDB: env.indexedDB,
        locks: env.locks,
        adoptIntervalMs,
    });
    const tab = { data, offline };
    opened.push(tab);
    return tab;
}

/**
 * Закрывает вкладку: офлайн-часть сохраняет очередь и отпускает lock
 */
async function closeTab(tab: { data: DataController; offline: OfflineSync }) {
    tab.data.dispose();
    await tab.offline.dispose();
    opened.splice(opened.indexOf(tab), 1);
}

afterEach(async () => {
    for (const tab of [...opened]) await closeTab(tab);
});

/**
 * Офлайн-часть контроллера: кэш в IndexedDB, очереди вкладок, Web Locks
 */
describe('offlineSync', () => {
    /**
     * Проверяет первый старт без кэша: кэша нет, после загрузки снимок сохраняется
     */
    it('start_withoutCache_returnsFalse_andSnapshotIsSavedAfterLoad', async () => {
        const env = browser();
        const tab = openTab(env, createFakeApi(types, structuredClone(objects)), 'tab1');

        expect(await tab.offline.start()).toBe(false);
        await tab.data.load();
        await tab.offline.flush();

        const db = await openOfflineDb('u1', { indexedDB: env.indexedDB });
        expect((await db.readSnapshot())?.objects).toEqual(objects);
        db.close();
    });

    /**
     * Проверяет перезагрузку без сети: кэш показывается сразу, неотправленная правка
     * переживает перезагрузку и видна поверх снимка
     */
    it('reload_offline_showsCacheAndKeepsUnsentEdit', async () => {
        const env = browser();
        const first = openTab(env, createFakeApi(types, structuredClone(objects)), 'tab1');
        await first.offline.start();
        await first.data.load();
        first.data.dispose(); // сеть пропала: отправка остановлена, правка остаётся в очереди
        await first.data.setProperty('a', 'name', 'Офлайн');
        await closeTab(first);

        const second = openTab(env, offlineApi(), 'tab2');

        expect(await second.offline.start()).toBe(true);
        expect(second.data.getSnapshot().status).toBe('ready');
        expect(second.data.getObject('a')?.properties.name).toBe('Офлайн');
        expect(second.data.sync.pending()).toHaveLength(1);
        await expect(second.data.catchUp()).rejects.toThrow();
        expect(second.data.getObject('a')?.properties.name).toBe('Офлайн');
    });

    /**
     * Проверяет, что после возвращения сети восстановленная очередь уходит на сервер
     */
    it('reload_online_restoredQueueIsSent', async () => {
        const env = browser();
        const api = createFakeApi(types, structuredClone(objects));
        const first = openTab(env, api, 'tab1');
        await first.offline.start();
        await first.data.load();
        first.data.dispose();
        await first.data.setProperty('a', 'name', 'Офлайн');
        const [pending] = first.data.sync.pending();
        await closeTab(first);

        const second = openTab(env, api, 'tab2');
        await second.offline.start();
        await second.data.catchUp();
        await whenSynced(second.data);

        expect(api.changesets.map((c) => c.id)).toEqual([pending.id]);
        expect(second.data.getObject('a')?.properties.name).toBe('Офлайн');
    });

    /**
     * Проверяет, что очередь открытой вкладки не подхватывается, а после её закрытия (lock
     * отпущен) — подхватывается открытой вкладкой
     */
    it('adopt_queueOfLiveTabIsKept_closedTabQueueIsAdopted', async () => {
        const env = browser();
        const other = openTab(env, offlineApi(), 'other');
        await other.offline.start();
        other.data.startFromCache({ seq: 0, types: types as never, objects });
        await other.data.setProperty('a', 'name', 'Из другой');
        await other.offline.flush();

        const mine = openTab(env, offlineApi(), 'mine', 20);
        await mine.offline.start();
        expect(mine.data.sync.pending()).toHaveLength(0);

        await closeTab(other);

        await vi.waitFor(() => expect(mine.data.sync.pending()).toHaveLength(1));
        expect(mine.data.getObject('a')?.properties.name).toBe('Из другой');
        await mine.offline.flush();
        const db = await openOfflineDb('u1', { indexedDB: env.indexedDB });
        expect([...(await db.readQueues()).keys()]).toEqual(['mine']);
        db.close();
    });

    /**
     * Проверяет подсчёт неотправленного для предупреждения при выходе: своя очередь и
     * сохранённые очереди других вкладок без повторов
     */
    it('unsentCount_countsOwnAndOtherTabsQueuesOnce', async () => {
        const env = browser();
        const other = openTab(env, offlineApi(), 'other');
        await other.offline.start();
        other.data.startFromCache({ seq: 0, types: types as never, objects });
        await other.data.setProperty('a', 'name', 'X');
        await other.offline.flush();

        const mine = openTab(env, offlineApi(), 'mine');
        await mine.offline.start();
        expect(await mine.offline.unsentCount()).toBe(1);

        mine.data.startFromCache({ seq: 0, types: types as never, objects });
        await mine.data.setProperty('a', 'name', 'Y');
        await mine.offline.flush();

        expect(await mine.offline.unsentCount()).toBe(2);
    });

    /**
     * Проверяет, что своя сохранённая очередь не учитывается: подтверждённый набор, ещё лежащий
     * в базе до следующего сохранения, не считается неотправленным
     */
    it('unsentCount_ownSavedQueueStale_countsOwnQueueFromMemory', async () => {
        const env = browser();
        const mine = openTab(env, offlineApi(), 'mine');
        await mine.offline.start();
        mine.data.startFromCache({ seq: 0, types: types as never, objects });
        await mine.data.setProperty('a', 'name', 'Y');
        await mine.offline.flush();
        expect(await mine.offline.unsentCount()).toBe(1);

        // Набор подтверждён, а база ещё хранит прежнюю очередь вкладки
        const [pending] = mine.data.sync.pending();
        mine.data.sync.confirm(pending!.id, 1, 0);

        expect(mine.data.sync.pending()).toEqual([]);
        expect(await mine.offline.unsentCount()).toBe(0);
    });
});
