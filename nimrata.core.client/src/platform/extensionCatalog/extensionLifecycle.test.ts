import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createExtensionRegistry } from '../extensionApi/registry';
import { fetchExtensionCatalog, putExtensionConnection } from './catalog';
import { createExtensionLifecycle } from './extensionLifecycle';

import type { ApiClient } from '../api/apiClient';
import type { DataController } from '../data/DataController';
import type { ExtensionDescriptor } from '../extensionApi/registry';
import type { ExtensionInfo } from './catalog';

vi.mock('./catalog', () => ({
    fetchExtensionCatalog: vi.fn(),
    putExtensionConnection: vi.fn(),
}));

const fetchCatalog = vi.mocked(fetchExtensionCatalog);
const putConnection = vi.mocked(putExtensionConnection);

const info = (id: string, connected: boolean): ExtensionInfo => ({
    id,
    name: id,
    description: '',
    icon: 'puzzle',
    defaultEnabled: true,
    connected,
    commands: [],
});

/** Отложенный промис: завершается вручную */
function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

/** Контроллер данных с управляемой загрузкой */
function fakeController(load: () => Promise<void> = async () => {}) {
    let snapshot = { status: 'ready', error: null as string | null };
    const resyncListeners = new Set<() => void>();
    return {
        load: vi.fn(async () => {
            await load();
        }),
        onResync(listener: () => void) {
            resyncListeners.add(listener);
            return () => void resyncListeners.delete(listener);
        },
        /** Сервер прислал `resync` (подключение расширения сменили в другой вкладке) */
        serverResync() {
            for (const listener of [...resyncListeners]) listener();
        },
        get resyncListenerCount() {
            return resyncListeners.size;
        },
        getSnapshot: () => snapshot,
        setSnapshot(next: { status: string; error: string | null }) {
            snapshot = next;
        },
    };
}

function setup(controller = fakeController(), startError?: string) {
    const log: string[] = [];
    const registry = createExtensionRegistry();
    for (const id of ['a', 'b']) {
        const descriptor: ExtensionDescriptor = {
            id,
            register: () => {
                log.push(`register:${id}`);
                return () => log.push(`unregister:${id}`);
            },
            ensureStart: async () => {
                log.push(`start:${id}`);
                return startError && id === 'b' ? { ok: false, error: startError } : { ok: true };
            },
        };
        registry.register(descriptor);
    }
    const onDataReloaded = vi.fn();
    const lifecycle = createExtensionLifecycle({
        api: {} as ApiClient,
        controller: controller as unknown as DataController,
        registry,
        onDataReloaded,
    });
    return { lifecycle, controller, log, onDataReloaded };
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('initialize', () => {
    it('регистрирует и запускает подключённые расширения, затем становится готовым', async () => {
        fetchCatalog.mockResolvedValue([info('a', true), info('b', false)]);
        const { lifecycle, log } = setup();

        await lifecycle.initialize();

        expect(log).toEqual(['register:a', 'start:a']);
        expect(lifecycle.getState()).toMatchObject({ status: 'ready', error: null });
        expect([...lifecycle.getState().activeIds]).toEqual(['a']);
    });

    it('при ошибке каталога переходит в error с причиной', async () => {
        fetchCatalog.mockRejectedValue(new Error('нет сети'));
        const { lifecycle } = setup();

        await lifecycle.initialize();

        expect(lifecycle.getState()).toMatchObject({ status: 'error', error: 'нет сети' });
    });

    it('при ошибке загрузки данных не запускает расширения, но становится готовым', async () => {
        fetchCatalog.mockResolvedValue([info('a', true)]);
        const controller = fakeController();
        controller.setSnapshot({ status: 'error', error: 'сбой' });
        const { lifecycle, log } = setup(controller);

        await lifecycle.initialize();

        expect(log).toEqual(['register:a']);
        expect(lifecycle.getState()).toMatchObject({ status: 'ready', error: null });
    });

    it('отказ запуска попадает в error, остальные расширения запускаются', async () => {
        fetchCatalog.mockResolvedValue([info('a', true), info('b', true)]);
        const { lifecycle, log } = setup(undefined, 'не вышло');

        await lifecycle.initialize();

        expect(log).toContain('start:a');
        expect(log).toContain('start:b');
        expect(lifecycle.getState().error).toBe('не вышло');
    });

    it('устаревший запуск прекращается, не затирая результат нового', async () => {
        const first = deferred<ExtensionInfo[]>();
        fetchCatalog.mockReturnValueOnce(first.promise);
        fetchCatalog.mockResolvedValueOnce([info('b', true)]);
        const { lifecycle, log } = setup();

        const stale = lifecycle.initialize();
        await lifecycle.initialize();
        first.resolve([info('a', true)]);
        await stale;

        expect(log).toEqual(['register:b', 'start:b']);
        expect([...lifecycle.getState().activeIds]).toEqual(['b']);
    });

    it('dispose отменяет запуск и снимает регистрации', async () => {
        const first = deferred<ExtensionInfo[]>();
        fetchCatalog.mockReturnValueOnce(first.promise);
        const { lifecycle, log } = setup();

        const run = lifecycle.initialize();
        lifecycle.dispose();
        first.resolve([info('a', true)]);
        await run;

        expect(log).toEqual([]);
        expect(lifecycle.getState().status).toBe('loading');
    });
});

describe('setConnected', () => {
    it('подключение сохраняет, регистрирует, перезагружает данные, сбрасывает выделение и запускает', async () => {
        fetchCatalog.mockResolvedValue([info('a', true), info('b', false)]);
        putConnection.mockResolvedValue(info('b', true));
        const { lifecycle, controller, log, onDataReloaded } = setup();
        await lifecycle.initialize();
        log.length = 0;
        controller.load.mockClear();

        const result = await lifecycle.setConnected('b', true);

        expect(result).toEqual({ ok: true });
        expect(log).toEqual(['register:b', 'start:b']);
        expect(controller.load).toHaveBeenCalledTimes(1);
        expect(onDataReloaded).toHaveBeenCalledTimes(1);
        expect(lifecycle.getState().switchingId).toBeNull();
    });

    it('отключение снимает регистрацию и не запускает расширение', async () => {
        fetchCatalog.mockResolvedValue([info('a', true)]);
        putConnection.mockResolvedValue(info('a', false));
        const { lifecycle, log } = setup();
        await lifecycle.initialize();
        log.length = 0;

        await lifecycle.setConnected('a', false);

        expect(log).toEqual(['unregister:a']);
    });

    it('повторный вызов при занятости отклоняется', async () => {
        fetchCatalog.mockResolvedValue([info('a', false), info('b', false)]);
        const put = deferred<ExtensionInfo>();
        putConnection.mockReturnValueOnce(put.promise);
        const { lifecycle } = setup();
        await lifecycle.initialize();

        const first = lifecycle.setConnected('a', true);
        const second = await lifecycle.setConnected('b', true);

        expect(second).toEqual({ ok: false, error: 'Переключение уже выполняется.' });
        expect(lifecycle.getState().switchingId).toBe('a');
        put.resolve(info('a', true));
        await first;
        expect(lifecycle.getState().switchingId).toBeNull();
    });

    it('неизвестное расширение и текущее состояние ничего не делают', async () => {
        fetchCatalog.mockResolvedValue([info('a', true)]);
        const { lifecycle } = setup();
        await lifecycle.initialize();

        expect(await lifecycle.setConnected('zzz', true)).toEqual({
            ok: false,
            error: 'Расширение не найдено.',
        });
        expect(await lifecycle.setConnected('a', true)).toEqual({ ok: true });
        expect(putConnection).not.toHaveBeenCalled();
    });

    it('отказ сервера возвращается как ошибка без изменения подключений', async () => {
        fetchCatalog.mockResolvedValue([info('a', false)]);
        putConnection.mockRejectedValue(new Error('отказ'));
        const { lifecycle, log } = setup();
        await lifecycle.initialize();

        const result = await lifecycle.setConnected('a', true);

        expect(result).toEqual({ ok: false, error: 'отказ' });
        expect(log).toEqual([]);
        expect(lifecycle.getState().error).toBeNull();
    });

    it('ошибка загрузки данных возвращается, выделение не сбрасывается, расширение не запускается', async () => {
        fetchCatalog.mockResolvedValue([info('a', false)]);
        putConnection.mockResolvedValue(info('a', true));
        const { lifecycle, controller, log, onDataReloaded } = setup();
        await lifecycle.initialize();
        controller.setSnapshot({ status: 'error', error: 'сбой загрузки' });

        const result = await lifecycle.setConnected('a', true);

        expect(result).toEqual({ ok: false, error: 'сбой загрузки' });
        expect(onDataReloaded).not.toHaveBeenCalled();
        expect(log).not.toContain('start:a');
        expect(lifecycle.getState().switchingId).toBeNull();
    });

    it('setOnDataReloaded заменяет обработчик перезагрузки данных', async () => {
        fetchCatalog.mockResolvedValue([info('a', false)]);
        putConnection.mockResolvedValue(info('a', true));
        const { lifecycle, onDataReloaded } = setup();
        const replacement = vi.fn();
        await lifecycle.initialize();
        lifecycle.setOnDataReloaded(replacement);

        await lifecycle.setConnected('a', true);

        expect(onDataReloaded).not.toHaveBeenCalled();
        expect(replacement).toHaveBeenCalledTimes(1);
    });

    it('отказ запуска возвращается вызывающему и не попадает в общее error', async () => {
        fetchCatalog.mockResolvedValue([info('b', false)]);
        putConnection.mockResolvedValue(info('b', true));
        const { lifecycle } = setup(undefined, 'не вышло');
        await lifecycle.initialize();

        const result = await lifecycle.setConnected('b', true);

        expect(result).toEqual({ ok: false, error: 'не вышло' });
        expect(lifecycle.getState().error).toBeNull();
    });
});

describe('гонка initialize и setConnected', () => {
    it('setConnected во время initialize не теряет подключение, новый initialize отменяет старый', async () => {
        fetchCatalog.mockResolvedValue([info('a', false)]);
        putConnection.mockResolvedValue(info('a', true));
        const loading = deferred();
        const controller = fakeController(() => loading.promise);
        const { lifecycle, log } = setup(controller);

        const init = lifecycle.initialize();
        await vi.waitFor(() => expect(controller.load).toHaveBeenCalled());
        // каталог уже получен, данные ещё грузятся
        const toggle = lifecycle.setConnected('a', true);
        loading.resolve();
        await Promise.all([init, toggle]);

        expect(lifecycle.getState().catalog[0].connected).toBe(true);
        expect(log.filter((e) => e === 'register:a')).toHaveLength(1);
    });
});

describe('подписка', () => {
    it('уведомляет подписчиков об изменении и перестаёт после отписки', async () => {
        fetchCatalog.mockResolvedValue([info('a', true)]);
        const { lifecycle } = setup();
        const listener = vi.fn();
        const unsubscribe = lifecycle.subscribe(listener);

        await lifecycle.initialize();
        expect(listener).toHaveBeenCalled();

        unsubscribe();
        listener.mockClear();
        await lifecycle.reload();
        expect(listener).not.toHaveBeenCalled();
    });

    it('reload сразу выставляет loading и сбрасывает ошибку', async () => {
        fetchCatalog.mockRejectedValueOnce(new Error('сбой'));
        fetchCatalog.mockResolvedValueOnce([info('a', true)]);
        const { lifecycle } = setup();
        await lifecycle.initialize();
        expect(lifecycle.getState().status).toBe('error');

        const run = lifecycle.reload();
        expect(lifecycle.getState()).toMatchObject({ status: 'loading', error: null });
        await run;
        expect(lifecycle.getState().status).toBe('ready');
    });
});

describe('офлайн: кэш каталога и данных', () => {
    /**
     * Проверяет старт без сети: каталог берётся из кэша, данные уже из кэша — вместо полной
     * загрузки догон (его отказ не ошибка), расширения регистрируются и запускаются
     */
    it('initialize_offlineWithCache_usesCachedCatalogAndCatchUpInsteadOfLoad', async () => {
        fetchCatalog.mockRejectedValue(new TypeError('Failed to fetch'));
        const controller = {
            ...fakeController(),
            catchUp: vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
        };
        const registry = createExtensionRegistry();
        const log: string[] = [];
        registry.register({
            id: 'a',
            register: () => () => undefined,
            ensureStart: async () => {
                log.push('start:a');
                return { ok: true };
            },
        });
        const lifecycle = createExtensionLifecycle({
            api: {} as ApiClient,
            controller: controller as unknown as DataController,
            registry,
            cached: true,
            catalogCache: { read: async () => [info('a', true)], write: vi.fn() },
        });

        await lifecycle.initialize();

        expect(lifecycle.getState()).toMatchObject({ status: 'ready', error: null });
        expect([...lifecycle.getState().activeIds]).toEqual(['a']);
        expect(controller.load).not.toHaveBeenCalled();
        expect(controller.catchUp).toHaveBeenCalled();
        expect(log).toEqual(['start:a']);
    });

    /**
     * Проверяет, что при кэше с устаревшими типами (манифест обновился) вместо догона идёт полная
     * загрузка, а при актуальных типах — догон
     */
    it.each([
        { serverVersion: 21, cachedVersion: 20, full: true },
        { serverVersion: 21, cachedVersion: 21, full: false },
    ])(
        'initialize_cachedTypesVersion$cachedVersion_serverVersion$serverVersion_fullLoad=$full',
        async ({ serverVersion, cachedVersion, full }) => {
            fetchCatalog.mockResolvedValue([{ ...info('a', true), version: serverVersion }]);
            const controller = {
                ...fakeController(),
                catchUp: vi.fn(async () => ({ ok: true })),
                getTypes: () => [{ id: 'T', extension: 'a', extensionVersion: cachedVersion }],
            };
            const lifecycle = createExtensionLifecycle({
                api: {} as ApiClient,
                controller: controller as unknown as DataController,
                registry: createExtensionRegistry(),
                cached: true,
            });

            await lifecycle.initialize();

            expect(controller.load).toHaveBeenCalledTimes(full ? 1 : 0);
            expect(controller.catchUp).toHaveBeenCalledTimes(full ? 0 : 1);
        },
    );

    /**
     * Проверяет, что загруженный с сервера каталог сохраняется в кэш
     */
    it('initialize_catalogFetched_isWrittenToCache', async () => {
        fetchCatalog.mockResolvedValue([info('a', true)]);
        const write = vi.fn();
        const lifecycle = createExtensionLifecycle({
            api: {} as ApiClient,
            controller: fakeController() as unknown as DataController,
            registry: createExtensionRegistry(),
            catalogCache: { read: async () => undefined, write },
        });

        await lifecycle.initialize();

        expect(write).toHaveBeenCalledWith([info('a', true)]);
    });

    /**
     * Проверяет, что без сети и без кэша каталога остаётся ошибка
     */
    it('initialize_offlineWithoutCachedCatalog_isError', async () => {
        fetchCatalog.mockRejectedValue(new Error('сбой'));
        const lifecycle = createExtensionLifecycle({
            api: {} as ApiClient,
            controller: fakeController() as unknown as DataController,
            registry: createExtensionRegistry(),
            catalogCache: { read: async () => undefined, write: vi.fn() },
        });

        await lifecycle.initialize();

        expect(lifecycle.getState()).toMatchObject({ status: 'error', error: 'сбой' });
    });
});

/**
 * Полная загрузка по сигналу сервера: подключение расширения сменили в другой вкладке
 */
describe('resync', () => {
    /**
     * Проверяет, что после `resync` каталог перечитывается, регистрации приводятся к нему,
     * новое подключённое расширение запускается, а выделение недоступного сбрасывается
     */
    it('serverResync_connectionChangedElsewhere_refreshesCatalogAndRegistrations', async () => {
        fetchCatalog.mockResolvedValueOnce([info('a', true), info('b', false)]);
        const { lifecycle, controller, log, onDataReloaded } = setup();
        await lifecycle.initialize();
        log.length = 0;
        fetchCatalog.mockResolvedValueOnce([info('a', false), info('b', true)]);

        controller.serverResync();
        await vi.waitFor(() => expect(log).toContain('start:b'));

        expect(log).toEqual(['unregister:a', 'register:b', 'start:b']);
        expect([...lifecycle.getState().activeIds]).toEqual(['b']);
        expect(lifecycle.getState().catalog.find((e) => e.id === 'b')?.connected).toBe(true);
        expect(onDataReloaded).toHaveBeenCalledTimes(1);
        expect(controller.load).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что `resync` без смены подключений ничего не перерегистрирует и не запускает
     */
    it('serverResync_nothingChanged_keepsRegistrations', async () => {
        fetchCatalog.mockResolvedValue([info('a', true)]);
        const { lifecycle, controller, log } = setup();
        await lifecycle.initialize();
        log.length = 0;

        controller.serverResync();
        await vi.waitFor(() => expect(fetchCatalog).toHaveBeenCalledTimes(2));

        expect(log).toEqual([]);
        expect(lifecycle.getState().status).toBe('ready');
    });

    /**
     * Проверяет, что без сети каталог остаётся прежним, а после dispose сигнал не слушается
     */
    it('serverResync_catalogFailsOrDisposed_keepsState', async () => {
        fetchCatalog.mockResolvedValueOnce([info('a', true)]);
        const { lifecycle, controller, log } = setup();
        await lifecycle.initialize();
        fetchCatalog.mockRejectedValueOnce(new Error('нет сети'));

        controller.serverResync();
        await vi.waitFor(() => expect(fetchCatalog).toHaveBeenCalledTimes(2));
        lifecycle.dispose();

        expect([...lifecycle.getState().activeIds]).toEqual(['a']);
        expect(lifecycle.getState().error).toBeNull();
        expect(controller.resyncListenerCount).toBe(0);
        expect(log).toEqual(['register:a', 'start:a', 'unregister:a']);
    });
});
