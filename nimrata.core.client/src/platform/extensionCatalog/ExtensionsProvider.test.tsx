import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createDataController } from '../data/DataController';
import { DataProvider } from '../data/DataProvider';
import { createFakeApi } from '../data/fakeApi';
import { ensureCreated } from '../extensionApi/ensureStart';
import { createExtensionRegistry } from '../extensionApi/registry';
import { SelectionProvider } from '../selection/SelectionProvider';
import { useSelection } from '../selection/useSelection';
import { ExtensionsProvider } from './ExtensionsProvider';
import { useExtensions } from './useExtensions';

import type { FakeApi } from '../data/fakeApi';
import type { ExtensionDescriptor } from '../extensionApi/registry';
import type { ExtensionsValue } from './ExtensionsContext';
import type { SelectionValue } from '../selection/SelectionContext';

const types = [
    { id: 'RootA', name: 'Корень A', extension: 'a', singleton: true },
    { id: 'ItemA', name: 'Элемент A', extension: 'a' },
    { id: 'RootB', name: 'Корень B', extension: 'b', singleton: true },
    { id: 'Platform', name: 'Платформенный' },
];

const catalog = [
    { id: 'a', name: 'Альфа', connected: true },
    { id: 'b', name: 'Бета', connected: true },
];

const stored = (id: string, type: string, parent: string | null = null) => ({
    id,
    type,
    parent,
    number: 0,
    properties: {},
});

/**
 * Дескриптор с журналом вызовов: корень своего типа создаётся идемпотентно
 */
function descriptor(id: string, rootType: string, log: string[]): ExtensionDescriptor {
    return {
        id,
        register: () => {
            log.push(`register:${id}`);
            return () => log.push(`unregister:${id}`);
        },
        ensureStart: (data) => {
            log.push(`start:${id}`);
            return ensureCreated(data, async () =>
                data.getChildren(null).some((o) => o.type === rootType)
                    ? { ok: true }
                    : data.perform((tx) => void tx.create({ type: rootType, parent: null })),
            );
        },
        bindings: [() => <p>привязка {id}</p>],
    };
}

interface SetupOptions {
    objects?: unknown[];
    extensions?: typeof catalog;
    descriptors?: (log: string[]) => ExtensionDescriptor[];
    /** Настройка API до монтирования провайдера */
    prepare?: (api: FakeApi, log: string[]) => void;
}

function setup(options: SetupOptions = {}) {
    const log: string[] = [];
    const api = createFakeApi(types, options.objects ?? [], {
        extensions: options.extensions ?? catalog,
    });
    options.prepare?.(api, log);
    const controller = createDataController({ api });
    const registry = createExtensionRegistry();
    const descriptors = options.descriptors?.(log) ?? [
        descriptor('a', 'RootA', log),
        descriptor('b', 'RootB', log),
    ];
    descriptors.forEach((d) => registry.register(d));
    const probe: { extensions?: ExtensionsValue; selection?: SelectionValue } = {};
    function Probe() {
        probe.extensions = useExtensions();
        probe.selection = useSelection();
        return null;
    }
    render(
        <SelectionProvider>
            <DataProvider controller={controller}>
                <ExtensionsProvider
                    api={api}
                    controller={controller}
                    registry={registry}
                    userId="u1"
                >
                    <Probe />
                </ExtensionsProvider>
            </DataProvider>
        </SelectionProvider>,
    );
    const ext = () => probe.extensions!;
    const ready = () => waitFor(() => expect(ext().status).toBe('ready'));
    const rootTypes = () =>
        controller
            .getChildren(null)
            .map((o) => o.type)
            .sort();
    return { api, controller, log, probe, ext, ready, rootTypes };
}

/**
 * Каталог расширений и подключение без перезагрузки страницы
 */
describe('ExtensionsProvider: initial start', () => {
    /**
     * Проверяет, что при старте регистрируются, запускаются и рисуют привязки только подключённые расширения
     */
    it('start_onlyConnectedExtensions_registeredStartedAndBound', async () => {
        const { ext, ready, log, rootTypes } = setup({
            extensions: [
                { id: 'a', name: 'Альфа', connected: true },
                { id: 'b', name: 'Бета', connected: false },
            ],
        });
        await ready();

        expect(log).toEqual(['register:a', 'start:a']);
        expect(rootTypes()).toEqual(['RootA']);
        expect(screen.getByText('привязка a')).toBeInTheDocument();
        expect(screen.queryByText('привязка b')).not.toBeInTheDocument();
        expect(ext().extensions.map((e) => [e.id, e.connected])).toEqual([
            ['a', true],
            ['b', false],
        ]);
    });

    /**
     * Проверяет, что расширение из реестра, которого нет в каталоге сервера, не подключается
     */
    it('start_descriptorWithoutCatalogEntry_isNotConnected', async () => {
        const { ready, log } = setup({ extensions: [{ id: 'a', name: 'Альфа', connected: true }] });
        await ready();

        expect(log).toEqual(['register:a', 'start:a']);
    });

    /**
     * Проверяет, что данные загружаются после регистрации, а запуск — после загрузки
     */
    it('start_order_registerThenLoadThenEnsureStart', async () => {
        const { ready, log } = setup({
            prepare: (api, log) => {
                const realGet = api.get.bind(api);
                api.get = (path) => {
                    if (path === 'objects') log.push('load');
                    return realGet(path);
                };
            },
        });
        await ready();

        expect(log).toEqual(['register:a', 'register:b', 'load', 'start:a', 'start:b']);
    });

    /**
     * Проверяет, что ошибка каталога переводит провайдер в состояние ошибки, а повтор её исправляет
     */
    it('start_catalogFails_showsErrorAndReloadRecovers', async () => {
        let fail = true;
        const { ext } = setup({
            prepare: (api) => {
                const realGet = api.get.bind(api);
                api.get = (path) =>
                    path === 'extensions' && fail
                        ? Promise.reject(new Error('каталог недоступен'))
                        : realGet(path);
            },
        });
        await waitFor(() => expect(ext().status).toBe('error'));
        expect(screen.getByRole('alert')).toHaveTextContent('каталог недоступен');

        fail = false;
        await act(() => ext().reload());

        await waitFor(() => expect(ext().status).toBe('ready'));
        expect(ext().error).toBeNull();
    });

    /**
     * Проверяет, что отказ запуска одного расширения не блокирует запуск второго и показывается как ошибка
     */
    it('start_oneExtensionFails_otherStillStartsAndErrorIsShown', async () => {
        const { ext, ready, rootTypes } = setup({
            descriptors: (log) => [
                {
                    ...descriptor('a', 'RootA', log),
                    ensureStart: () => Promise.resolve({ ok: false, error: 'сбой запуска A' }),
                },
                descriptor('b', 'RootB', log),
            ],
        });
        await ready();

        expect(rootTypes()).toEqual(['RootB']);
        expect(ext().error).toBe('сбой запуска A');
        expect(screen.getByRole('alert')).toHaveTextContent('сбой запуска A');
    });
});

/**
 * Переключение расширений на лету
 */
describe('ExtensionsProvider: switching', () => {
    /**
     * Проверяет, что отключение снимает регистрацию и привязки, прячет данные и очищает Undo/Redo
     */
    it('disconnect_unregistersHidesDataAndClearsUndo', async () => {
        const { controller, ext, ready, log, rootTypes } = setup();
        await ready();
        const root = controller.getChildren(null).find((o) => o.type === 'RootA')!;
        await controller.create({ type: 'ItemA', parent: root.id });
        expect(controller.canUndo()).toBe(true);
        log.length = 0;

        let result: Awaited<ReturnType<ExtensionsValue['setConnected']>> | undefined;
        await act(async () => {
            result = await ext().setConnected('a', false);
        });

        expect(result).toEqual({ ok: true });
        expect(log).toEqual(['unregister:a']);
        expect(rootTypes()).toEqual(['RootB']);
        expect(controller.getObject(root.id)).toBeUndefined();
        expect(controller.canUndo()).toBe(false);
        expect(controller.canRedo()).toBe(false);
        expect(screen.queryByText('привязка a')).not.toBeInTheDocument();
        expect(screen.getByText('привязка b')).toBeInTheDocument();
        expect(ext().extensions.find((e) => e.id === 'a')?.connected).toBe(false);
    });

    /**
     * Проверяет, что повторное подключение возвращает данные без дубликатов корней и запускает ensureStart после загрузки
     */
    it('reconnect_returnsDataWithoutDuplicateRootsAndStartsAfterLoad', async () => {
        const { api, controller, ext, ready, log, rootTypes } = setup();
        await ready();
        const rootId = controller.getChildren(null).find((o) => o.type === 'RootA')!.id;
        await act(() => ext().setConnected('a', false));
        log.length = 0;
        const realGet = api.get.bind(api);
        api.get = (path) => {
            if (path === 'objects') log.push('load');
            return realGet(path);
        };
        const sent = api.changesets.length;

        await act(() => ext().setConnected('a', true));

        expect(log).toEqual(['register:a', 'load', 'start:a']);
        expect(rootTypes()).toEqual(['RootA', 'RootB']);
        expect(controller.getObject(rootId)).toBeDefined();
        expect(api.changesets).toHaveLength(sent);
        expect(screen.getByText('привязка a')).toBeInTheDocument();
    });

    /**
     * Проверяет, что при гонке (клиент не видит корень, сервер отвечает singleton_exists) дубликата нет и ошибки нет
     */
    it('connect_singletonRace_createsNoDuplicateAndNoError', async () => {
        const { api, controller, ext, ready, rootTypes } = setup({
            extensions: [
                { id: 'a', name: 'Альфа', connected: false },
                { id: 'b', name: 'Бета', connected: true },
            ],
            objects: [stored('ra', 'RootA'), stored('rb', 'RootB')],
        });
        await ready();
        // первая загрузка после подключения устарела: корень на сервере есть, клиент его не получил
        const realGet = api.get.bind(api);
        let stale = true;
        api.get = (path) => {
            if (path === 'objects' && stale) {
                stale = false;
                return Promise.resolve([stored('rb', 'RootB')] as never);
            }
            return realGet(path);
        };

        let result: Awaited<ReturnType<ExtensionsValue['setConnected']>> | undefined;
        await act(async () => {
            result = await ext().setConnected('a', true);
        });

        expect(result).toEqual({ ok: true });
        expect(ext().error).toBeNull();
        expect(api.changesets).toHaveLength(0);
        expect(rootTypes()).toEqual(['RootA', 'RootB']);
        expect(controller.getObject('ra')).toBeDefined();
    });

    /**
     * Проверяет, что выделение недоступного объекта сбрасывается, а выделение объекта платформы остаётся
     */
    it('disconnect_selection_resetOnlyForUnavailableObjects', async () => {
        const { probe, ext, ready } = setup({
            objects: [stored('ra', 'RootA'), stored('p', 'Platform')],
        });
        await ready();

        act(() => probe.selection!.select('p'));
        await act(() => ext().setConnected('a', false));
        expect(probe.selection!.selectedId).toBe('p');

        act(() => probe.selection!.select('ra'));
        await act(() => ext().setConnected('a', true));
        expect(probe.selection!.selectedId).toBe('ra');

        await act(() => ext().setConnected('a', false));
        expect(probe.selection!.selectedId).toBeNull();
    });

    /**
     * Проверяет, что отказ сервера при смене подключения не меняет состояние, возвращается как причина и не дублируется глобальным alert
     */
    it('setConnected_putFails_keepsStateAndReturnsReason', async () => {
        const { api, ext, ready, log } = setup();
        await ready();
        log.length = 0;
        api.put = () => Promise.reject(new Error('сервер недоступен'));

        let result: Awaited<ReturnType<ExtensionsValue['setConnected']>> | undefined;
        await act(async () => {
            result = await ext().setConnected('a', false);
        });

        expect(result).toEqual({ ok: false, error: 'сервер недоступен' });
        // ошибку переключения показывает карточка, глобального alert нет
        expect(ext().error).toBeNull();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(log).toEqual([]);
        expect(ext().extensions.find((e) => e.id === 'a')?.connected).toBe(true);
        expect(ext().switchingId).toBeNull();
    });

    /**
     * Проверяет, что во время переключения указан его идентификатор, а второе переключение отклоняется
     */
    it('setConnected_whileSwitching_exposesSwitchingIdAndRejectsSecondCall', async () => {
        const { api, ext, ready } = setup();
        await ready();
        let release: () => void = () => undefined;
        const realPut = api.put.bind(api);
        api.put = (path, body) =>
            new Promise((resolve) => {
                release = () => resolve(realPut(path, body));
            });

        let first: Promise<unknown> = Promise.resolve();
        act(() => {
            first = ext().setConnected('a', false);
        });
        await waitFor(() => expect(ext().switchingId).toBe('a'));
        const second = await ext().setConnected('b', false);
        expect(second.ok).toBe(false);

        await act(async () => {
            release();
            await first;
        });
        expect(ext().switchingId).toBeNull();
    });

    /**
     * Проверяет, что подключение уже подключённого расширения ничего не делает
     */
    it('setConnected_alreadyInThatState_doesNothing', async () => {
        const { api, ext, ready } = setup();
        await ready();
        const put = vi.spyOn(api, 'put');

        const result = await ext().setConnected('a', true);

        expect(result).toEqual({ ok: true });
        expect(put).not.toHaveBeenCalled();
    });

    /**
     * Проверяет, что неизвестное расширение возвращает ошибку
     */
    it('setConnected_unknownExtension_returnsError', async () => {
        const { ext, ready } = setup();
        await ready();

        const result = await ext().setConnected('zzz', true);

        expect(result.ok).toBe(false);
    });
});
