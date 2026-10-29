import { describe, expect, it, vi } from 'vitest';

import { createDataController } from './DataController';
import { createFakeApi, postChangeset } from './fakeApi';

import type { ApiClient } from '@platform/api/apiClient';
import type { StoreSnapshot } from './dataStore';

const types = [
    { id: 'Folder', name: 'Папка', extension: 't', extensionVersion: 1 },
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'title', name: 'Название', kind: 'string' }],
    },
];

const objects = [
    { id: 'root', type: 'Folder', parent: null, number: 1, properties: {} },
    { id: 'a', type: 'Note', parent: 'root', number: 1, properties: { title: 'A' } },
];

/**
 * API без сети: каждый запрос падает сетевой ошибкой (не `ApiError`)
 */
function offlineApi(): ApiClient {
    const fail = () => Promise.reject(new TypeError('Failed to fetch'));
    return { get: fail, post: fail, put: fail, delete: fail };
}

const cached: StoreSnapshot = { seq: 0, types: types as StoreSnapshot['types'], objects };

/**
 * Контроллер данных без сети: итог действий локальный, старт из кэша, освобождение
 */
describe('DataController: offline', () => {
    /**
     * Проверяет, что итог действия разрешается, как только набор встал в очередь, — без ответа
     * сервера (сети нет)
     */
    it('action_resolvesLocally_withoutServerAnswer', async () => {
        const data = createDataController({ api: offlineApi() });
        data.startFromCache(cached);

        const created = await data.create({ type: 'Note', parent: 'root' });

        expect(created.ok).toBe(true);
        expect(created.ok && data.getObject(created.id)).toBeTruthy();
        expect(data.sync.pending()).toHaveLength(1);
        data.dispose();
    });

    /**
     * Проверяет, что с `confirmed: true` итог ждёт ответа сервера и несёт его отказ
     */
    it('action_confirmedOption_waitsForServerRejection', async () => {
        const api = createFakeApi(types, structuredClone(objects));
        const data = createDataController({ api });
        await data.load();
        api.rejectNext(422, 'Нельзя.', 'some_code');

        const result = await data.setProperty('a', 'title', 'X', { confirmed: true });

        expect(result).toMatchObject({ ok: false, error: 'Нельзя.', code: 'some_code' });
        data.dispose();
    });

    /**
     * Проверяет, что отказ сервера после локального итога откатывает правку, убирает запись undo
     * и показывает сводное уведомление
     */
    it('serverRejection_afterLocalResult_rollsBackWithNoticeAndDropsUndo', async () => {
        const api = createFakeApi(types, structuredClone(objects));
        const data = createDataController({ api });
        await data.load();
        api.rejectNext(422, 'Нельзя.');

        const result = await data.setProperty('a', 'title', 'X');
        expect(result.ok).toBe(true);
        expect(data.canUndo()).toBe(true);

        await vi.waitFor(() => expect(data.getSnapshot().error).toBe('Нельзя.'));
        expect(data.getObject('a')?.properties.title).toBe('A');
        expect(data.canUndo()).toBe(false);
        data.dispose();
    });

    /**
     * Проверяет старт из кэша: модель видна сразу (статус «готово»), затем догон приносит
     * изменения сервера после курсора кэша
     */
    it('startFromCache_showsCacheAtOnce_thenCatchUpBringsServerChanges', async () => {
        const api = createFakeApi(types, structuredClone(objects));
        await postChangeset(api, [
            { op: 'update', id: 'a', changes: { title: { old: 'A', new: 'Server' } } },
        ]);
        const data = createDataController({ api });

        data.startFromCache(cached);

        expect(data.getSnapshot().status).toBe('ready');
        expect(data.getObject('a')?.properties.title).toBe('A');

        await data.catchUp();

        expect(data.getObject('a')?.properties.title).toBe('Server');
        expect(data.sync.getSeq()).toBe(1);
        data.dispose();
    });

    /**
     * Проверяет, что без сети догон отказывает, а модель остаётся рабочей на кэше
     */
    it('startFromCache_offline_catchUpFailsButModelStaysReady', async () => {
        const data = createDataController({ api: offlineApi() });
        data.startFromCache(cached);

        await expect(data.catchUp()).rejects.toThrow();

        expect(data.getSnapshot().status).toBe('ready');
        expect(data.getObject('a')).toBeDefined();
        data.dispose();
    });

    /**
     * Проверяет, что после `dispose` таймеры сетевой части не срабатывают и запросов больше нет
     */
    it('dispose_stopsSyncEngineTimers', async () => {
        vi.useFakeTimers();
        try {
            const api = offlineApi();
            const post = vi.spyOn(api, 'post');
            const data = createDataController({ api });
            data.startFromCache(cached);
            await data.setProperty('a', 'title', 'X');

            data.dispose();
            await vi.advanceTimersByTimeAsync(120_000);

            expect(post).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
