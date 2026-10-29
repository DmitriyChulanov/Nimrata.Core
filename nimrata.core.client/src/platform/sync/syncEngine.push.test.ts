import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataStore } from '@platform/data/dataStore';
import { createFakeApi, postChangeset } from '@platform/data/fakeApi';

import {
    SYNC_CATCHUP_DELAY_MS,
    SYNC_RETRY_BASE_MS,
    SYNC_WINDOW_MS,
    createSyncEngine,
} from './syncEngine';

import type { ChangeResult } from '@platform/data/DataController';
import type { DataStore } from '@platform/data/dataStore';
import type { Operation } from '@platform/data/undoHistory';
import type { TypeDefinition } from '@platform/types/types';
import type { PushHandlers } from './syncEngine';

const types: TypeDefinition[] = [
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'title', name: 'Название', kind: 'string' }],
    },
];

const note = (id: string, title: string, number = 1) => ({
    id,
    type: 'Note',
    parent: null,
    number,
    properties: { title },
});

/**
 * Поддельный push-канал: тест сам вызывает обработчики, как сервер
 *
 * @returns канал и доступ к обработчикам подключённого движка
 */
function fakePush() {
    let handlers: PushHandlers | null = null;
    let stopped = 0;
    return {
        channel: (h: PushHandlers) => {
            handlers = h;
            return () => {
                stopped++;
                handlers = null;
            };
        },
        /** Обработчики подключённого движка */
        get on(): PushHandlers {
            if (!handlers) throw new Error('Канал не подключён.');
            return handlers;
        },
        get stopped() {
            return stopped;
        },
    };
}

/**
 * Сервер в режиме «как настоящий» (снимок видит принятые наборы), хранилище и движок с push
 *
 * @returns сервер, хранилище, канал, вход движка и журнал GET-запросов
 */
function setup() {
    const api = createFakeApi(types, [note('a', 'A')], { extensions: [] });
    const gets: string[] = [];
    const get = api.get.bind(api);
    api.get = (path) => {
        gets.push(path);
        return get(path);
    };
    const posts: unknown[] = [];
    const post = api.post.bind(api);
    api.post = (path, body) => {
        posts.push(body);
        return post(path, body);
    };
    let counter = 0;
    const store = createDataStore({ newChangesetId: () => `cs-${++counter}` });
    const push = fakePush();
    const link = createSyncEngine(api, { push: push.channel })(store);
    return { api, store, push, link, gets, posts };
}

/**
 * Правка названия объекта в очереди хранилища
 *
 * @param store - хранилище
 * @param id - объект
 * @param title - новое название
 * @returns ожидание итога набора
 */
function rename(store: DataStore, id: string, title: string): Promise<ChangeResult> {
    const local = store.beginLocal();
    const operation: Operation = {
        op: 'update',
        id,
        changes: { title: { old: local.get(id)?.properties.title ?? null, new: title } },
    };
    local.apply(operation);
    return local.commit([operation]).outcome;
}

/**
 * Правка «из другой вкладки»: набор уходит на сервер мимо хранилища
 *
 * @param api - сервер
 * @param id - объект
 * @param title - новое название
 * @returns курсор применённого набора
 */
async function renameElsewhere(api: ReturnType<typeof createFakeApi>, id: string, title: string) {
    const result = await postChangeset(api, [
        { op: 'update', id, changes: { title: { new: title } } },
    ]);
    return result.seq ?? 0;
}

/**
 * SyncEngine: push, догон и полная загрузка
 */
describe('syncEngine: push', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Проверяет, что сообщение push применяется к хранилищу и сдвигает курсор
     */
    it('push_changes_appliedToStore', async () => {
        const { store, push, link } = setup();
        await link.resync();

        push.on.changes({
            fromSeq: 0,
            toSeq: 7,
            changesetIds: ['other'],
            upserts: [note('a', 'B')],
            deletes: [],
        });

        expect(store.getObject('a')?.properties.title).toBe('B');
        expect(store.getSeq()).toBe(7);
    });

    /**
     * Проверяет, что push с курсором впереди клиентского запускает догон с сервера, а не применяется
     */
    it('push_gapBeforeFromSeq_catchesUpSinceCursor', async () => {
        const { api, store, push, link, gets } = setup();
        await link.resync();
        await renameElsewhere(api, 'a', 'B');
        const last = await renameElsewhere(api, 'a', 'C');

        push.on.changes({
            fromSeq: last - 1,
            toSeq: last,
            changesetIds: ['x'],
            upserts: [note('a', 'C')],
            deletes: [],
        });
        await vi.advanceTimersByTimeAsync(0);

        expect(gets).toContain('changes?since=0');
        expect(store.getSeq()).toBe(last);
        expect(store.getObject('a')?.properties.title).toBe('C');
    });

    /**
     * Проверяет, что до первой загрузки соединение и push ничего не делают: данные даст загрузка
     */
    it('push_beforeFirstLoad_ignored', async () => {
        const { store, push, gets } = setup();

        push.on.connected();
        push.on.changes({ fromSeq: 0, toSeq: 3, changesetIds: [], upserts: [], deletes: [] });
        await vi.advanceTimersByTimeAsync(0);

        expect(gets).toEqual([]);
        expect(store.getSeq()).toBe(0);
    });

    /**
     * Проверяет, что после соединения клиент догоняет с курсора и сразу отправляет очередь,
     * не дожидаясь задержки повтора
     */
    it('connected_catchesUpAndSendsQueueAtOnce', async () => {
        const { api, store, push, link, gets, posts } = setup();
        await link.resync();
        await renameElsewhere(api, 'a', 'B');
        api.rejectNext(500, 'нет сети');
        const outcome = rename(store, 'a', 'Mine');
        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);
        expect(posts).toHaveLength(2);
        expect(store.pending()).toHaveLength(1);

        push.on.connected();
        await vi.advanceTimersByTimeAsync(0);

        expect(gets).toContain('changes?since=0');
        expect(posts).toHaveLength(3);
        await expect(outcome).resolves.toEqual({ ok: true });
        expect(store.getSeq()).toBe(2);
        expect(store.getObject('a')?.properties.title).toBe('Mine');
        await vi.advanceTimersByTimeAsync(SYNC_RETRY_BASE_MS * 2);
        expect(posts).toHaveLength(3);
    });

    /**
     * Проверяет, что `resync` перечитывает снимок, а правка, сделанная во время загрузки,
     * остаётся в очереди, наложена на снимок и уходит на сервер
     */
    it('resync_reloadsSnapshot_keepsQueueOnTop', async () => {
        const { api, store, push, link } = setup();
        await link.resync();
        api.objects = [...api.objects, note('b', 'B', 2)];
        const get = api.get;
        let release = () => {};
        api.get = async (path) => {
            if (path === 'snapshot') {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
            }
            return get(path);
        };

        push.on.resync();
        await vi.advanceTimersByTimeAsync(0);
        const outcome = rename(store, 'a', 'Mine');
        release();
        await vi.advanceTimersByTimeAsync(0);

        expect(store.getObject('b')?.properties.title).toBe('B');
        expect(store.getObject('a')?.properties.title).toBe('Mine');
        expect(store.pending()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);
        await expect(outcome).resolves.toEqual({ ok: true });
        expect((api.objects as ReturnType<typeof note>[])[0]?.properties.title).toBe('Mine');
    });

    /**
     * Проверяет, что перед полной загрузкой неотправленные наборы уходят сразу: снимок их уже
     * содержит, и переналожение не дублирует применённое
     */
    it('resync_unsentQueue_sentBeforeSnapshot', async () => {
        const { api, store, link, gets, posts } = setup();
        await link.resync();
        const outcome = rename(store, 'a', 'Mine');

        await link.resync();

        expect(posts).toHaveLength(1);
        expect(gets.at(-1)).toBe('snapshot');
        await expect(outcome).resolves.toEqual({ ok: true });
        expect(store.pending()).toEqual([]);
        expect(store.getObject('a')?.properties.title).toBe('Mine');
        expect(api.changesets).toHaveLength(1);
    });

    /**
     * Проверяет, что догон, ответивший `resync`, переходит к полной загрузке
     */
    it('catchUp_resyncAnswer_reloadsSnapshot', async () => {
        const { store, push, link, gets } = setup();
        await link.resync();
        store.reset({ seq: 50, types, objects: [] });

        push.on.connected();
        await vi.advanceTimersByTimeAsync(0);

        expect(gets.slice(-2)).toEqual(['changes?since=50', 'snapshot']);
        expect(store.getSeq()).toBe(0);
        expect(store.getObject('a')).toBeDefined();
    });

    /**
     * Проверяет, что подтверждение с разрывом курсора (были чужие наборы) догоняет через паузу
     */
    it('confirm_gapInSeq_catchesUpAfterDelay', async () => {
        const { api, store, link, gets } = setup();
        await link.resync();
        await renameElsewhere(api, 'a', 'Elsewhere');
        const outcome = rename(store, 'a', 'Mine');
        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);
        await expect(outcome).resolves.toEqual({ ok: true });
        expect(store.getSeq()).toBe(0);

        await vi.advanceTimersByTimeAsync(SYNC_CATCHUP_DELAY_MS);

        expect(gets.at(-1)).toBe('changes?since=0');
        expect(store.getSeq()).toBe(2);
    });

    /**
     * Проверяет, что догона по разрыву нет, если push успел сдвинуть курсор
     */
    it('confirm_gapClosedByPush_noCatchUp', async () => {
        const { api, store, push, link, gets } = setup();
        await link.resync();
        await renameElsewhere(api, 'a', 'Elsewhere');
        void rename(store, 'a', 'Mine');
        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);

        push.on.changes({
            fromSeq: 0,
            toSeq: 2,
            changesetIds: ['other', 'cs-1'],
            upserts: [note('a', 'Mine')],
            deletes: [],
        });
        await vi.advanceTimersByTimeAsync(SYNC_CATCHUP_DELAY_MS);

        expect(gets).toEqual(['snapshot']);
        expect(store.getSeq()).toBe(2);
    });

    /**
     * Проверяет, что канал можно подключить после загрузки и отключить, не отключая движок
     */
    it('connect_laterChannel_catchesUpOnConnectAndStopsOnDisconnect', async () => {
        const { api, store, link } = setup();
        await link.resync();
        await renameElsewhere(api, 'a', 'B');
        const later = fakePush();

        const disconnect = link.connect(later.channel);
        later.on.connected();
        await vi.advanceTimersByTimeAsync(0);
        disconnect();

        expect(store.getObject('a')?.properties.title).toBe('B');
        expect(later.stopped).toBe(1);
    });

    /**
     * Проверяет, что отключение движка закрывает push-канал
     */
    it('dispose_stopsPushChannel', () => {
        const { push, link } = setup();

        link.dispose();

        expect(push.stopped).toBe(1);
    });
});
