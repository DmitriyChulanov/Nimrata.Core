import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useOptionalSelection } from '@platform/selection/useOptionalSelection';
import { Button } from '@platform/ui';

import { fetchExtensionCatalog, putExtensionConnection } from './catalog';
import { ExtensionsContext } from './ExtensionsContext';

import type { ReactNode } from 'react';
import type { ApiClient } from '@platform/api/apiClient';
import type { ChangeResult, DataController } from '@platform/data/DataController';
import type { ExtensionRegistry } from '@platform/extensionApi/registry';
import type { ExtensionInfo } from './catalog';
import type { ExtensionsStatus, ExtensionsValue } from './ExtensionsContext';

/**
 * Свойства компонента `ExtensionsProvider`
 */
export interface ExtensionsProviderProps {
    /** API-клиент (каталог расширений и подключения) */
    api: ApiClient;
    /** Контроллер данных пользователя: расширения подключают к нему хуки и действия */
    controller: DataController;
    /** Реестр клиентских дескрипторов расширений */
    registry: ExtensionRegistry;
    /** Вошедший пользователь (передаётся компонентам-привязкам расширений) */
    userId: string;
    /** Показ объекта в дереве, передаётся расширениям при регистрации */
    reveal?: (id: string) => void;
    /** Вложенные элементы */
    children: ReactNode;
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
 * Приводит произвольную ошибку к тексту причины
 *
 * @param error - пойманное значение, не обязательно `Error`
 * @returns сообщение ошибки или строковое представление значения
 */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Каталог расширений пользователя и их жизненный цикл на клиенте. Загружает каталог, регистрирует
 * подключённые расширения реестра, загружает данные и запускает `ensureStart`; рисует
 * компоненты-привязки подключённых расширений. Переключение подключений — `setConnected`.
 * Размещается внутри провайдеров данных и выделения
 *
 * @param props - свойства провайдера, описаны в `ExtensionsProviderProps`
 * @returns провайдер контекста расширений с привязками подключённых расширений и вложенными элементами
 */
export function ExtensionsProvider({
    api,
    controller,
    registry,
    userId,
    reveal,
    children,
}: ExtensionsProviderProps) {
    const [catalog, setCatalog] = useState<ExtensionInfo[]>([]);
    const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(() => new Set());
    const [status, setStatus] = useState<ExtensionsStatus>('loading');
    const [error, setError] = useState<string | null>(null);
    const [switchingId, setSwitchingId] = useState<string | null>(null);

    const catalogRef = useRef<ExtensionInfo[]>([]);
    const registrations = useRef(new Map<string, () => void>());
    const busy = useRef(false);
    // Поколение запуска: устаревшие (отменённые размонтированием или повтором) прекращают работу
    const generation = useRef(0);

    const selection = useOptionalSelection();
    const selectionRef = useRef(selection);
    useEffect(() => {
        selectionRef.current = selection;
    });

    /**
     * Запоминает каталог и в ссылке, и в состоянии
     *
     * @param items - актуальный каталог расширений
     */
    const commitCatalog = useCallback((items: ExtensionInfo[]) => {
        catalogRef.current = items;
        setCatalog(items);
    }, []);

    /**
     * Приводит регистрации хуков и действий в соответствие с набором подключённых расширений
     *
     * @param connected - идентификаторы подключённых расширений
     */
    const syncRegistrations = useCallback(
        (connected: ReadonlySet<string>) => {
            for (const [id, unregister] of [...registrations.current]) {
                if (!connected.has(id)) {
                    unregister();
                    registrations.current.delete(id);
                }
            }
            for (const descriptor of registry.list()) {
                if (connected.has(descriptor.id) && !registrations.current.has(descriptor.id)) {
                    registrations.current.set(
                        descriptor.id,
                        descriptor.register(controller, { reveal }),
                    );
                }
            }
        },
        [controller, registry, reveal],
    );

    // Снимает выделение, если выделенного объекта после перезагрузки больше нет
    const dropUnavailableSelection = useCallback(() => {
        const current = selectionRef.current;
        if (current?.selectedId && !controller.getObject(current.selectedId)) current.select(null);
    }, [controller]);

    /**
     * Запускает расширения по очереди; отказ одного не мешает остальным (каждое создаёт только
     * свои объекты своим набором)
     *
     * @param ids - идентификаторы запускаемых расширений
     * @returns первая причина отказа или `null`, если запустились все
     */
    const startExtensions = useCallback(
        async (ids: Iterable<string>): Promise<string | null> => {
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
        },
        [controller, registry],
    );

    /**
     * Прекращает работу запущенных `initialize` и снимает все регистрации
     */
    const teardown = useCallback(() => {
        generation.current++;
        registrations.current.forEach((unregister) => unregister());
        registrations.current.clear();
    }, []);

    /**
     * Загружает каталог и данные, регистрирует и запускает подключённые расширения; устаревший
     * запуск (отменённый размонтированием или повтором) молча прекращается
     *
     * @returns промис завершения запуска
     */
    const initialize = useCallback(async () => {
        const runGeneration = ++generation.current;
        const cancelled = () => generation.current !== runGeneration;

        let items: ExtensionInfo[];
        try {
            items = await fetchExtensionCatalog(api);
        } catch (e) {
            if (cancelled()) return;
            setError(messageOf(e));
            setStatus('error');
            return;
        }
        if (cancelled()) return;

        const connected = connectedIds(items);
        syncRegistrations(connected);
        commitCatalog(items);
        setActiveIds(connected);

        await controller.load();
        if (cancelled()) return;
        // ошибку загрузки данных показывает основной экран (с повтором)
        const startError =
            controller.getSnapshot().status === 'ready' ? await startExtensions(connected) : null;
        if (cancelled()) return;
        setError(startError);
        setStatus('ready');
    }, [api, controller, syncRegistrations, commitCatalog, startExtensions]);

    useEffect(() => {
        void initialize();
        return teardown;
    }, [initialize, teardown]);

    /**
     * Повторяет загрузку каталога и данных (состояние «загрузка» выставляется сразу)
     *
     * @returns промис завершения повторного запуска
     */
    const reload = useCallback(() => {
        setStatus('loading');
        setError(null);
        return initialize();
    }, [initialize]);

    /**
     * Подключает или отключает расширение: сохраняет на сервере, перерегистрирует хуки, перезагружает
     * данные и запускает подключённое расширение. Причина отказа возвращается вызывающему (её
     * показывает карточка расширения) и в общее `error` не попадает
     *
     * @param id - идентификатор расширения каталога
     * @param connected - нужное состояние подключения
     * @returns результат переключения с причиной отказа
     */
    const setConnected = useCallback(
        async (id: string, connected: boolean): Promise<ChangeResult> => {
            const fail = (reason: string): ChangeResult => ({ ok: false, error: reason });
            if (busy.current) return { ok: false, error: 'Переключение уже выполняется.' };
            const current = catalogRef.current.find((e) => e.id === id);
            if (!current) return { ok: false, error: 'Расширение не найдено.' };
            if (current.connected === connected) return { ok: true };

            busy.current = true;
            setSwitchingId(id);
            try {
                let updated: ExtensionInfo;
                try {
                    updated = await putExtensionConnection(api, id, connected);
                } catch (e) {
                    return fail(messageOf(e));
                }

                const items = catalogRef.current.map((e) =>
                    e.id === id ? { ...e, ...updated, connected } : e,
                );
                commitCatalog(items);
                const ids = connectedIds(items);
                syncRegistrations(ids);
                setActiveIds(ids);

                await controller.load();
                const { status: dataStatus, error: dataError } = controller.getSnapshot();
                if (dataStatus !== 'ready') {
                    return fail(dataError ?? 'Не удалось загрузить данные.');
                }
                dropUnavailableSelection();

                if (connected) {
                    const startError = await startExtensions([id]);
                    if (startError !== null) return fail(startError);
                }
                return { ok: true };
            } finally {
                busy.current = false;
                setSwitchingId(null);
            }
        },
        [
            api,
            controller,
            commitCatalog,
            syncRegistrations,
            dropUnavailableSelection,
            startExtensions,
        ],
    );

    const value = useMemo<ExtensionsValue>(
        () => ({
            status,
            error,
            extensions: catalog,
            switchingId,
            setConnected,
            reload,
        }),
        [status, error, catalog, switchingId, setConnected, reload],
    );

    return (
        <ExtensionsContext.Provider value={value}>
            {registry
                .list()
                .filter((extension) => activeIds.has(extension.id))
                .flatMap((extension) =>
                    (extension.bindings ?? []).map((Binding, index) => (
                        <Binding key={`${extension.id}:${index}`} userId={userId} />
                    )),
                )}
            {error && <p role="alert">{error}</p>}
            {status === 'error' && <Button onClick={() => void reload()}>Повторить</Button>}
            {children}
        </ExtensionsContext.Provider>
    );
}
