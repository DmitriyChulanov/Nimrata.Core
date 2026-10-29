import { reloadData } from '@platform/extensionApi/reloadData';

import { fetchExtensionCatalog, putExtensionConnection } from './catalog';

import type { ApiClient } from '@platform/api/apiClient';
import type { ChangeResult, DataController } from '@platform/data/DataController';
import type { ExtensionRegistry } from '@platform/extensionApi/registry';
import type { ExtensionInfo } from './catalog';
import type { ExtensionsStatus } from './ExtensionsContext';

/**
 * Состояние подключения расширений; новый объект при каждом изменении
 */
export interface ExtensionLifecycleState {
    /** Каталог расширений с действующим состоянием подключений */
    catalog: ExtensionInfo[];
    /** Идентификаторы подключённых расширений */
    activeIds: ReadonlySet<string>;
    /** Состояние загрузки каталога и первичного запуска */
    status: ExtensionsStatus;
    /** Последняя ошибка загрузки каталога или запуска; `null`, если её нет */
    error: string | null;
    /** Идентификатор переключаемого сейчас расширения; `null` — переключения нет */
    switchingId: string | null;
}

/**
 * Параметры подключения расширений
 */
export interface ExtensionLifecycleOptions {
    /** API-клиент (каталог расширений и подключения) */
    api: ApiClient;
    /** Контроллер данных пользователя */
    controller: DataController;
    /** Реестр клиентских дескрипторов расширений */
    registry: ExtensionRegistry;
    /** Показ объекта в дереве, передаётся расширениям при регистрации */
    reveal?: (id: string) => void;
    /** Вызывается после перезагрузки данных при переключении: сбросить выделение недоступных объектов */
    onDataReloaded?: () => void;
}

/**
 * Подключение расширений без React (ADR 0003): синхронизирует регистрации, загружает данные
 * и запускает расширения
 */
export interface ExtensionLifecycle {
    /** Текущее состояние (тот же объект, пока ничего не менялось) */
    getState(): ExtensionLifecycleState;
    /** Подписка на изменение состояния; возвращает функцию отписки */
    subscribe(listener: () => void): () => void;
    /** Загружает каталог и данные, регистрирует и запускает подключённые расширения; устаревший запуск молча прекращается */
    initialize(): Promise<void>;
    /** Повторяет `initialize`, сразу выставляя состояние «загрузка» */
    reload(): Promise<void>;
    /** Подключает или отключает расширение; параллельное переключение отклоняется */
    setConnected(id: string, connected: boolean): Promise<ChangeResult>;
    /** Отменяет запущенный `initialize` и снимает все регистрации */
    dispose(): void;
    /** Заменяет обработчик перезагрузки данных, не пересоздавая подключение */
    setOnDataReloaded(handler: (() => void) | undefined): void;
}

/**
 * Приводит произвольную ошибку к тексту причины
 *
 * @param error - пойманное значение, не обязательно `Error`
 * @returns сообщение ошибки или строковое представление значения
 */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Выбирает идентификаторы подключённых расширений каталога
 *
 * @param items - элементы каталога расширений
 * @returns множество идентификаторов расширений с признаком `connected`
 */
function connectedIds(items: ExtensionInfo[]): Set<string> {
    return new Set(items.filter((e) => e.connected).map((e) => e.id));
}

/**
 * Создаёт подключение расширений
 *
 * @param options - параметры, описаны в `ExtensionLifecycleOptions`
 * @returns подключение с состоянием и операциями
 */
export function createExtensionLifecycle(options: ExtensionLifecycleOptions): ExtensionLifecycle {
    const { api, controller, registry, reveal } = options;
    let onDataReloaded = options.onDataReloaded;

    let state: ExtensionLifecycleState = {
        catalog: [],
        activeIds: new Set(),
        status: 'loading',
        error: null,
        switchingId: null,
    };
    const listeners = new Set<() => void>();
    const registrations = new Map<string, () => void>();
    let busy = false;
    // Поколение запуска: устаревшие (отменённые dispose или повтором) прекращают работу
    let generation = 0;

    function update(patch: Partial<ExtensionLifecycleState>) {
        state = { ...state, ...patch };
        listeners.forEach((listener) => listener());
    }

    // Приводит регистрации хуков и действий в соответствие с набором подключённых расширений
    function syncRegistrations(connected: ReadonlySet<string>) {
        for (const [id, unregister] of [...registrations]) {
            if (!connected.has(id)) {
                unregister();
                registrations.delete(id);
            }
        }
        for (const descriptor of registry.list()) {
            if (connected.has(descriptor.id) && !registrations.has(descriptor.id)) {
                registrations.set(descriptor.id, descriptor.register(controller, { reveal }));
            }
        }
    }

    // Запускает по очереди; отказ одного не мешает остальным (каждое создаёт только свои объекты)
    async function startExtensions(ids: Iterable<string>): Promise<string | null> {
        const wanted = new Set(ids);
        let firstError: string | null = null;
        for (const descriptor of registry.list()) {
            if (!wanted.has(descriptor.id)) continue;
            let result: ChangeResult;
            try {
                result = await descriptor.ensureStart(controller);
            } catch (e) {
                result = { ok: false, error: messageOf(e) };
            }
            if (!result.ok) firstError ??= result.error;
        }
        return firstError;
    }

    async function initialize(): Promise<void> {
        const runGeneration = ++generation;
        const cancelled = () => generation !== runGeneration;

        let items: ExtensionInfo[];
        try {
            items = await fetchExtensionCatalog(api);
        } catch (e) {
            if (cancelled()) return;
            update({ error: messageOf(e), status: 'error' });
            return;
        }
        if (cancelled()) return;

        const connected = connectedIds(items);
        syncRegistrations(connected);
        update({ catalog: items, activeIds: connected });

        // ошибку загрузки данных показывает основной экран (с повтором)
        const loaded = await reloadData(controller);
        if (cancelled()) return;
        const startError = loaded.ok ? await startExtensions(connected) : null;
        if (cancelled()) return;
        update({ error: startError, status: 'ready' });
    }

    async function setConnected(id: string, connected: boolean): Promise<ChangeResult> {
        const fail = (reason: string): ChangeResult => ({ ok: false, error: reason });
        if (busy) return fail('Переключение уже выполняется.');
        const current = state.catalog.find((e) => e.id === id);
        if (!current) return fail('Расширение не найдено.');
        if (current.connected === connected) return { ok: true };

        busy = true;
        update({ switchingId: id });
        try {
            let updated: ExtensionInfo;
            try {
                updated = await putExtensionConnection(api, id, connected);
            } catch (e) {
                return fail(messageOf(e));
            }

            const items = state.catalog.map((e) =>
                e.id === id ? { ...e, ...updated, connected } : e,
            );
            const ids = connectedIds(items);
            syncRegistrations(ids);
            update({ catalog: items, activeIds: ids });

            const loaded = await reloadData(controller);
            if (!loaded.ok) return loaded;
            onDataReloaded?.();

            if (connected) {
                const startError = await startExtensions([id]);
                if (startError !== null) return fail(startError);
            }
            return { ok: true };
        } finally {
            busy = false;
            update({ switchingId: null });
        }
    }

    return {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
        initialize,
        reload() {
            update({ status: 'loading', error: null });
            return initialize();
        },
        setConnected,
        setOnDataReloaded(handler) {
            onDataReloaded = handler;
        },
        dispose() {
            generation++;
            registrations.forEach((unregister) => unregister());
            registrations.clear();
        },
    };
}
