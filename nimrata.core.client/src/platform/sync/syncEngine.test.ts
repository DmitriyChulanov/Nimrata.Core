import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@platform/api/apiClient';
import { createDataStore } from '@platform/data/dataStore';
import { createFakeApi } from '@platform/data/fakeApi';

import {
    SYNC_MAX_OPERATIONS,
    SYNC_RETRY_BASE_MS,
    SYNC_WINDOW_MS,
    createSyncEngine,
} from './syncEngine';

import type { ChangeResult, ChangesetResult } from '@platform/data/DataController';
import type { DataStore } from '@platform/data/dataStore';
import type { Operation } from '@platform/data/undoHistory';
import type { TypeDefinition } from '@platform/types/types';

const types: TypeDefinition[] = [
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'title', name: 'Название', kind: 'string' }],
    },
];

const objects = [{ id: 'a', type: 'Note', parent: null, number: 1, properties: { title: 'A' } }];

/**
 * Отправленный запрос: наборы пакета
 */
interface SentRequest {
    /** Наборы в порядке пакета */
    changesets: { id: string; operations: Operation[] }[];
}

/**
 * Хранилище, подставной сервер с журналом запросов и подключённый SyncEngine
 *
 * @returns хранилище, сервер, журнал запросов и функция отключения
 */
function setup() {
    const api = createFakeApi(types, structuredClone(objects));
    const requests: SentRequest[] = [];
    const post = api.post.bind(api);
    api.post = (path, body) => {
        requests.push(structuredClone(body) as SentRequest);
        return post(path, body);
    };
    let counter = 0;
    const store = createDataStore({ newChangesetId: () => `cs-${++counter}` });
    store.reset({ seq: 0, types, objects: structuredClone(objects) });
    const dispose = createSyncEngine(api)(store);
    return { api, store, requests, dispose };
}

/**
 * Ставит в очередь набор из нескольких правок названия объекта `a`
 *
 * @param store - хранилище
 * @param count - число операций в наборе
 * @param label - префикс новых значений
 * @returns ожидание итога набора
 */
function edit(store: DataStore, count = 1, label = 'v'): Promise<ChangeResult> {
    const local = store.beginLocal();
    const operations: Operation[] = [];
    for (let i = 0; i < count; i++) {
        const old = local.get('a')?.properties.title ?? null;
        const operation: Operation = {
            op: 'update',
            id: 'a',
            changes: { title: { old, new: `${label}${i}` } },
        };
        local.apply(operation);
        operations.push(operation);
    }
    return local.commit(operations).outcome;
}

/**
 * Число операций в запросе
 *
 * @param request - отправленный запрос
 * @returns сумма операций всех наборов
 */
function operationCount(request: SentRequest): number {
    return request.changesets.reduce((sum, c) => sum + c.operations.length, 0);
}

/**
 * SyncEngine: пакетная отправка очереди
 */
describe('syncEngine', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Проверяет константы модуля: окно 200 мс, лимит 500 операций
     */
    it('constants_windowAndLimit_matchSpec', () => {
        expect(SYNC_WINDOW_MS).toBe(200);
        expect(SYNC_MAX_OPERATIONS).toBe(500);
    });

    /**
     * Проверяет, что правки за окно уходят одним запросом и не раньше конца окна
     */
    it('send_editsWithinWindow_oneRequestAfterWindow', async () => {
        const { store, requests } = setup();
        for (let i = 0; i < 300; i++) void edit(store, 1, `e${i}-`);

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS - 1);
        expect(requests).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(requests).toHaveLength(1);
        expect(requests[0]?.changesets).toHaveLength(300);
        expect(store.pending()).toEqual([]);
    });

    /**
     * Проверяет, что тысяча правок за окно уходит не тысячей запросов, а по лимиту операций:
     * два запроса по 500, второй — сразу после первого, без нового окна
     */
    it('send_thousandEditsWithinWindow_splitByOperationLimitOnly', async () => {
        const { store, requests } = setup();
        const outcomes = Array.from({ length: 1000 }, (_, i) => edit(store, 1, `e${i}-`));

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);

        expect(requests.map(operationCount)).toEqual([500, 500]);
        expect((await Promise.all(outcomes)).every((r) => r.ok)).toBe(true);
        expect(store.getObject('a')?.properties.title).toBe('e999-0');
        expect(store.getSeq()).toBe(1000);
    });

    /**
     * Проверяет, что окно отсчитывается от первой правки, а не от последней (не debounce)
     */
    it('window_countsFromFirstEdit_notDebounce', async () => {
        const { store, requests } = setup();
        void edit(store, 1, 'first');
        await vi.advanceTimersByTimeAsync(150);
        void edit(store, 1, 'second');

        await vi.advanceTimersByTimeAsync(50);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.changesets).toHaveLength(2);
    });

    /**
     * Проверяет, что одновременно в полёте не больше одного запроса, а новые наборы копятся
     * и уходят следующим запросом
     */
    it('send_requestInFlight_newChangesetsAccumulate', async () => {
        const { api, store, requests } = setup();
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const post = api.post.bind(api);
        let inFlight = 0;
        let maxInFlight = 0;
        api.post = async (path, body) => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            try {
                if (requests.length === 0) await gate;
                return await post(path, body);
            } finally {
                inFlight--;
            }
        };
        void edit(store, 1, 'first');
        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);
        for (let i = 0; i < 3; i++) void edit(store, 1, `next${i}-`);

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS * 5);
        expect(store.pending()).toHaveLength(4);
        release();
        await vi.advanceTimersByTimeAsync(0);

        expect(maxInFlight).toBe(1);
        expect(requests.map((r) => r.changesets.length)).toEqual([1, 3]);
        expect(store.pending()).toEqual([]);
    });

    /**
     * Проверяет, что пакет делится по лимиту операций без разрыва набора, а набор больше лимита
     * уходит целиком отдельным запросом
     */
    it('split_byOperationLimit_keepsChangesetsWhole', async () => {
        const { store, requests } = setup();
        void edit(store, 300, 'x');
        void edit(store, 300, 'y');
        void edit(store, 600, 'z');
        void edit(store, 1, 'w');

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);

        expect(requests.map((r) => r.changesets.map((c) => c.operations.length))).toEqual([
            [300],
            [300],
            [600],
            [1],
        ]);
    });

    /**
     * Проверяет, что наборы не схлопываются: две правки одного свойства — два набора в пакете
     */
    it('send_editsOfSameProperty_notCollapsed', async () => {
        const { store, requests } = setup();
        void edit(store, 1, 'one');
        void edit(store, 1, 'two');

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);

        expect(requests[0]?.changesets.map((c) => c.id)).toEqual(['cs-1', 'cs-2']);
    });

    /**
     * Проверяет обработку статусов: `applied` подтверждает, `rejected` откатывает с причиной,
     * `duplicate` подтверждает
     */
    it('results_byStatus_confirmOrReject', async () => {
        const { api, store } = setup();
        api.post = () =>
            Promise.resolve([
                { id: 'cs-1', status: 'applied', seq: 1 },
                { id: 'cs-2', status: 'rejected', code: 'bad', detail: 'нельзя' },
                { id: 'cs-3', status: 'duplicate', seq: 2 },
            ] satisfies ChangesetResult[] as never);
        const first = edit(store, 1, 'one');
        const second = edit(store, 1, 'two');
        const third = edit(store, 1, 'three');

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);

        expect(await first).toEqual({ ok: true });
        expect(await second).toMatchObject({ ok: false, error: 'нельзя', code: 'bad' });
        expect(await third).toEqual({ ok: true });
        expect(store.getSeq()).toBe(2);
        expect(store.pending()).toEqual([]);
    });

    /**
     * Проверяет, что итоги применяются к хранилищу в порядке очереди, даже если сервер вернул
     * их в другом порядке
     */
    it('results_outOfOrder_appliedInQueueOrder', async () => {
        const { api, store } = setup();
        const post = api.post.bind(api);
        api.post = async (path, body) => {
            const results = await post<ChangesetResult[]>(path, body);
            return [...results].reverse() as never;
        };
        void edit(store, 1, 'one');
        void edit(store, 1, 'two');

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);

        expect(store.getSeq()).toBe(2);
        expect(store.getConfirmedObject('a')?.properties.title).toBe('two0');
    });

    /**
     * Проверяет, что набор без итога в ответе отклоняется, а не висит в очереди
     */
    it('results_missingResult_rejectsChangeset', async () => {
        const { api, store } = setup();
        api.post = () => Promise.resolve([] as never);
        const outcome = edit(store);

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);

        expect(await outcome).toMatchObject({ ok: false });
        expect(store.pending()).toEqual([]);
    });

    /**
     * Проверяет, что при сетевой ошибке очередь сохраняется, а запрос повторяется
     * с экспоненциальной задержкой, пока не пройдёт
     */
    it('retry_networkError_keepsQueueWithExponentialBackoff', async () => {
        const { api, store, requests } = setup();
        const post = api.post.bind(api);
        let failures = 3;
        api.post = (path, body) => {
            if (failures-- <= 0) return post(path, body);
            requests.push(structuredClone(body) as SentRequest);
            return Promise.reject(new TypeError('Failed to fetch'));
        };
        let settled = false;
        void edit(store).then(() => (settled = true));

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);
        expect(requests).toHaveLength(1);
        expect(store.pending()).toHaveLength(1);
        expect(store.getObject('a')?.properties.title).toBe('v0');

        await vi.advanceTimersByTimeAsync(SYNC_RETRY_BASE_MS - 1);
        expect(requests).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(requests).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(SYNC_RETRY_BASE_MS * 2 - 1);
        expect(requests).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(requests).toHaveLength(3);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(SYNC_RETRY_BASE_MS * 4);

        expect(requests).toHaveLength(4);
        expect(settled).toBe(true);
        expect(store.pending()).toEqual([]);
        expect(store.getSeq()).toBe(1);
    });

    /**
     * Проверяет, что ответ 5xx не откатывает набор, а повторяется вместе с накопившимися наборами
     */
    it('retry_serverError_resendsWithAccumulatedChangesets', async () => {
        const { api, store, requests } = setup();
        api.rejectNext(500, 'сбой');
        void edit(store, 1, 'one');
        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);
        void edit(store, 1, 'two');

        await vi.advanceTimersByTimeAsync(SYNC_RETRY_BASE_MS);

        expect(requests.map((r) => r.changesets.map((c) => c.id))).toEqual([
            ['cs-1'],
            ['cs-1', 'cs-2'],
        ]);
        expect(store.pending()).toEqual([]);
        expect(api.changesets).toHaveLength(2);
    });

    /**
     * Проверяет, что после успешного повтора задержка сбрасывается к начальной
     */
    it('retry_afterSuccess_backoffResets', async () => {
        const { api, store, requests } = setup();
        api.rejectNext(503, 'сбой');
        void edit(store, 1, 'one');
        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS + SYNC_RETRY_BASE_MS);
        expect(requests).toHaveLength(2);

        api.rejectNext(503, 'сбой');
        void edit(store, 1, 'two');
        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS + SYNC_RETRY_BASE_MS);

        expect(requests).toHaveLength(4);
        expect(store.pending()).toEqual([]);
    });

    /**
     * Проверяет, что отказ запроса по формату (4xx) отклоняет наборы пакета, а не повторяется
     */
    it('send_clientError_rejectsBatch', async () => {
        const { api, store, requests } = setup();
        api.rejectNext(400, 'плохой запрос');
        const outcome = edit(store);

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS + SYNC_RETRY_BASE_MS * 10);

        expect(await outcome).toMatchObject({ ok: false, error: 'плохой запрос', status: 400 });
        expect(requests).toHaveLength(1);
        expect(store.getObject('a')?.properties.title).toBe('A');
    });

    /**
     * Проверяет, что истёкший вход (401) не теряет очередь: запрос повторяется
     */
    it('retry_unauthorized_keepsQueue', async () => {
        const { api, store } = setup();
        api.post = () => Promise.reject(new ApiError(401, 'Нужен вход'));
        void edit(store);

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS + SYNC_RETRY_BASE_MS * 10);

        expect(store.pending()).toHaveLength(1);
    });

    /**
     * Проверяет, что набор, убранный из очереди до отправки (каскад, догон), не отправляется
     */
    it('send_changesetRemovedBeforeWindow_notSent', async () => {
        const { store, requests } = setup();
        void edit(store);
        store.reject('cs-1', { error: 'убран' });

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS);

        expect(requests).toHaveLength(0);
    });

    /**
     * Проверяет, что после отключения запросы больше не отправляются
     */
    it('dispose_stopsSending', async () => {
        const { store, requests, dispose } = setup();
        void edit(store);
        dispose();

        await vi.advanceTimersByTimeAsync(SYNC_WINDOW_MS * 10);

        expect(requests).toHaveLength(0);
        expect(store.pending()).toHaveLength(1);
    });
});
