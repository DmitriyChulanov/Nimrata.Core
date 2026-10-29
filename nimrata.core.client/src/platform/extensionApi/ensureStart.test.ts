import { describe, expect, it, vi } from 'vitest';

import { createDataController } from '../data/DataController';
import { createFakeApi, whenSynced } from '../data/fakeApi';
import { ensureCreated } from './ensureStart';

import type { ChangeResult } from '../data/DataController';

const types = [{ id: 'Root', name: 'Корень', extension: 'x', singleton: true }];

const hasRoot = (data: ReturnType<typeof createDataController>) =>
    data.getChildren(null).some((o) => o.type === 'Root');

/**
 * Создаёт корень, если его нет в модели
 */
const createRoot = (data: ReturnType<typeof createDataController>) => () =>
    hasRoot(data)
        ? Promise.resolve<ChangeResult>({ ok: true })
        : data.perform((tx) => void tx.create({ type: 'Root', parent: null }), { confirmed: true });

async function loaded() {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    return { api, data };
}

/**
 * Идемпотентный запуск расширения: гонки и устаревшие данные
 */
describe('ensureCreated', () => {
    /**
     * Проверяет, что без отказа выполняется одна попытка
     */
    it('ensureCreated_success_runsAttemptOnce', async () => {
        const { api, data } = await loaded();
        const result = await ensureCreated(data, createRoot(data));
        expect(result).toEqual({ ok: true });
        expect(api.changesets).toHaveLength(1);
    });

    /**
     * Проверяет, что отказ singleton_exists — «уже есть»: не ошибка, данные перезагружены, дубликата нет
     */
    it('ensureCreated_singletonExists_isNotErrorAndReloadsData', async () => {
        const { api, data } = await loaded();
        // сервер уже содержит корень, созданный в другой вкладке; клиент о нём не знает
        api.objects = [{ id: 'other', type: 'Root', parent: null, number: 0, properties: {} }];

        const result = await ensureCreated(data, createRoot(data));

        expect(result).toEqual({ ok: true });
        expect(api.changesets).toHaveLength(0);
        expect(data.getChildren(null).map((o) => o.id)).toEqual(['other']);
    });

    /**
     * Проверяет, что отказ запроса без кода возвращается как есть: ни перезагрузки, ни повтора
     */
    it('ensureCreated_requestFailureWithoutCode_returnedAsIsWithoutRetry', async () => {
        const { api, data } = await loaded();
        api.rejectNext(409, 'расхождение');
        const attempt = vi.fn(createRoot(data));

        const result = await ensureCreated(data, attempt);

        expect(result).toMatchObject({ ok: false, status: 409 });
        expect(attempt).toHaveBeenCalledTimes(1);
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что прочие отказы показываются как есть, без перезагрузки и повтора
     */
    it('ensureCreated_otherError_returnedAsIs', async () => {
        const { api, data } = await loaded();
        api.rejectNext(422, 'нельзя');
        const attempt = vi.fn(createRoot(data));

        const result = await ensureCreated(data, attempt);

        expect(result).toMatchObject({ ok: false, error: 'нельзя', status: 422 });
        expect(attempt).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что после отказа сервера записи не блокируются: следующая попытка уходит на сервер
     */
    it('ensureCreated_afterRejection_writesAreNotBlocked', async () => {
        const { api, data } = await loaded();
        api.rejectNext(500, 'сбой');
        await data.perform((tx) => void tx.create({ type: 'Root', parent: null }));

        const result = await ensureCreated(data, createRoot(data));

        expect(result).toEqual({ ok: true });
        await whenSynced(data);
        expect(api.changesets).toHaveLength(1);
        expect(hasRoot(data)).toBe(true);
    });
});
