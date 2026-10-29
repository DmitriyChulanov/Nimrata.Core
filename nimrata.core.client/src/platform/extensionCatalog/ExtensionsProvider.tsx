import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { useOptionalSelection } from '@platform/selection/useOptionalSelection';
import { Button } from '@platform/ui';

import { ExtensionsContext } from './ExtensionsContext';
import { createExtensionLifecycle } from './extensionLifecycle';

import type { ReactNode } from 'react';
import type { ApiClient } from '@platform/api/apiClient';
import type { DataController } from '@platform/data/DataController';
import type { ExtensionRegistry } from '@platform/extensionApi/registry';
import type { ExtensionsValue } from './ExtensionsContext';

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
 * Каталог расширений пользователя и их жизненный цикл на клиенте: тонкая обёртка над
 * `createExtensionLifecycle` (загрузка каталога, регистрация, загрузка данных, `ensureStart`,
 * переключение подключений). Рисует компоненты-привязки подключённых расширений и сбрасывает
 * выделение недоступных объектов после переключения. Размещается внутри провайдеров данных и
 * выделения
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
    const selection = useOptionalSelection();
    const selectionRef = useRef(selection);
    useEffect(() => {
        selectionRef.current = selection;
    });

    // Снимает выделение, если выделенного объекта после перезагрузки больше нет
    const dropUnavailableSelection = useCallback(() => {
        const current = selectionRef.current;
        if (!current) return;
        const alive = current.selectedIds.filter((id) => controller.getObject(id));
        if (alive.length === current.selectedIds.length) return;
        const primary =
            current.selectedId && alive.includes(current.selectedId) ? current.selectedId : null;
        current.setSelection(alive, primary);
    }, [controller]);

    const lifecycle = useMemo(
        () => createExtensionLifecycle({ api, controller, registry, reveal }),
        [api, controller, registry, reveal],
    );

    useEffect(() => {
        lifecycle.setOnDataReloaded(dropUnavailableSelection);
    }, [lifecycle, dropUnavailableSelection]);

    useEffect(() => {
        void lifecycle.initialize();
        return lifecycle.dispose;
    }, [lifecycle]);

    const { catalog, activeIds, status, error, switchingId } = useSyncExternalStore(
        lifecycle.subscribe,
        lifecycle.getState,
    );

    const value = useMemo<ExtensionsValue>(
        () => ({
            status,
            error,
            extensions: catalog,
            switchingId,
            setConnected: lifecycle.setConnected,
            reload: lifecycle.reload,
        }),
        [status, error, catalog, switchingId, lifecycle],
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
            {status === 'error' && (
                <Button onClick={() => void lifecycle.reload()}>Повторить</Button>
            )}
            {children}
        </ExtensionsContext.Provider>
    );
}
