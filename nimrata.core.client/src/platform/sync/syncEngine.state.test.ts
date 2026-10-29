import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataStore } from '@platform/data/dataStore';
import { createFakeApi } from '@platform/data/fakeApi';

import { SYNC_RETRY_BASE_MS, SYNC_WINDOW_MS, createSyncEngine } from './syncEngine';

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

const note = { id: 'a', type: 'Note', parent: null, number: 1, properties: { title: 'A' } };

/**
 * Сервер, хранилище и движок с поддельным push-каналом; `offline` включает «нет сети» для
 * всех запросов (fetch отказывает `TypeError`)
 *
 * @returns сервер, хранилище, вход движка, обработчики push и переключатель сети
 */
function setup() {
    const api = createFakeApi(types, [structuredClone(note)], { extensions: [] });
    const network = { down: false };
    const get = api.get.bind(api);
    const post = api.post.bind(api);
    api.get = (path) =>
        network.down ? Promise.reject(new TypeError('Failed to fetch')) : get(path);
    api.post = (path, body) =>
        network.down ? Promise.reject(new TypeError('Failed to fetch')) : post(path, body);
    let handlers: PushHandlers | null = null;
    let counter = 0;
    const store = createDataStore({ newChangesetId: () => `cs-${++counter}` });
    const link = createSyncEngine(api, {
        push: (h) => {
            handlers = h;
            return () => undefined;
        },
    })(store);
    const push = () => {
        if (!handlers) throw new Error('Канал не подключён.');
        return handlers;
    };
    return { api, store, link, push, network };
}

/**
 * Правка названия объекта `a` в очереди хранилища
 *
 * @param store - хранилище
 * @param title - новое название
 */
function rename(store: DataStore, title: string): void {
    const local = store.beginLocal();
    const operation: Operation = {
        op: 'update',
        id: 'a',
        changes: { title: { old: local.get('a')?.properties.title ?? null, new: title } },
    };
    local.apply(operation);
    void local.commit([operation]).outcome;
}

/**
 * SyncEngine: состояние связи с сервером для индикатора и сигнал полной загрузки по запросу сервера
 */
describe('syncEngine: state', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Проверяет, что до первых запросов связь считается рабочей
     */
    it('state_initially_online', () => {
        const { link } = setup();

        expect(link.getState()).toEqual({ connection: 'online', error: null });
    });

    /**
     * Проверяет, что сбой сети при отправке переводит в «офлайн», а удачный повтор — обратно
     */
    it('state_networkFailureThenRecovery_offlineThenOnline', async () => {
        const { store, link, network } = setup();
        await link.resync();
        const listener = vi.fn();
        link.subscribeState(listener);
        network.down = true;

        rename(store, 'B');
        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);

        expect(link.getState().connection).toBe('offline');
        expect(listener).toHaveBeenCalled();
        network.down = false;
        await vi.advanceTimersByTimeAsync(SYNC_RETRY_BASE_MS);
        expect(link.getState()).toEqual({ connection: 'online', error: null });
        expect(store.pending()).toEqual([]);
    });

    /**
     * Проверяет, что сбой сервера (5xx) — «ошибка» с текстом причины, очередь сохраняется
     */
    it('state_serverFailure_errorWithMessage', async () => {
        const { api, store, link } = setup();
        await link.resync();
        api.rejectNext(500, 'Сервер недоступен.');

        rename(store, 'B');
        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);

        expect(link.getState()).toEqual({ connection: 'error', error: 'Сервер недоступен.' });
        expect(store.pending()).toHaveLength(1);
    });

    /**
     * Проверяет, что сбой сети при полной загрузке тоже переводит в «офлайн»
     */
    it('state_snapshotNetworkFailure_offline', async () => {
        const { link, network } = setup();
        network.down = true;

        await expect(link.resync()).rejects.toThrow();

        expect(link.getState().connection).toBe('offline');
    });

    /**
     * Проверяет, что обрыв push-соединения — «офлайн», а новое соединение возвращает «онлайн»
     */
    it('state_pushDisconnectedThenConnected_offlineThenOnline', async () => {
        const { link, push } = setup();
        await link.resync();

        push().disconnected();
        expect(link.getState().connection).toBe('offline');

        push().connected();
        expect(link.getState().connection).toBe('online');
    });

    /**
     * Проверяет, что после полной загрузки по сигналу сервера (`resync` push) подписчики узнают
     * о ней — уже с новым снимком в хранилище, а своя загрузка (`link.resync`) их не тревожит
     */
    it('onResync_serverRequested_notifiedAfterSnapshot', async () => {
        const { api, store, link, push } = setup();
        await link.resync();
        const seen: (string | undefined)[] = [];
        link.onResync(() => seen.push(store.getObject('b')?.id));
        await link.resync();
        expect(seen).toEqual([]);
        api.objects = [
            ...api.objects,
            { id: 'b', type: 'Note', parent: null, number: 2, properties: { title: 'B' } },
        ];

        push().resync();
        await vi.advanceTimersByTimeAsync(0);

        expect(seen).toEqual(['b']);
    });

    /**
     * Проверяет, что ответ догона `resync` (сервер не может отдать разницу) тоже сообщается
     */
    it('onResync_catchUpAnswer_notified', async () => {
        const { store, link, push } = setup();
        await link.resync();
        const listener = vi.fn();
        link.onResync(listener);
        store.reset({ seq: 50, types, objects: [] });

        push().connected();
        await vi.advanceTimersByTimeAsync(0);

        expect(listener).toHaveBeenCalledTimes(1);
    });
});
