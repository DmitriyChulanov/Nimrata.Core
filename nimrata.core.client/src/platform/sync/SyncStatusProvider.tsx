import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { SyncStatusContext } from './SyncStatusContext';

import type { ReactNode } from 'react';
import type { DataController } from '@platform/data/DataController';
import type { SyncStatusValue } from './SyncStatusContext';

/** Период пересчёта неотправленных всех вкладок, мс: очереди других вкладок меняются без событий */
export const SYNC_STATUS_POLL_MS = 5000;
/**
 * Повторный пересчёт после смены своей очереди, мс: её копия в IndexedDB обновляется с задержкой
 * (`OFFLINE_SAVE_DELAY_MS`), до этого база ещё помнит подтверждённые наборы
 */
export const SYNC_STATUS_SETTLE_MS = 500;

/**
 * Свойства компонента `SyncStatusProvider`
 */
export interface SyncStatusProviderProps {
    /** Контроллер данных пользователя */
    controller: DataController;
    /** Неотправленные наборы всех вкладок (`OfflineSync.unsentCount`) */
    unsentCount: () => Promise<number>;
    /** Вход не проверен из-за отсутствия сети (`AuthStatus` `'offline'`) */
    signedInOffline?: boolean;
    /** Вложенные элементы */
    children: ReactNode;
}

/**
 * Состояние синхронизации для индикатора: связь сетевой части (`DataController.getSyncState`),
 * неотправленные наборы всех вкладок и ошибка загрузки данных
 *
 * @param props - свойства провайдера, описаны в `SyncStatusProviderProps`
 * @returns провайдер контекста состояния синхронизации
 */
export function SyncStatusProvider({
    controller,
    unsentCount,
    signedInOffline = false,
    children,
}: SyncStatusProviderProps) {
    const { connection, error } = useSyncExternalStore(
        controller.subscribeSyncState,
        controller.getSyncState,
    );
    const loadError = useSyncExternalStore(controller.subscribe, () => {
        const snapshot = controller.getSnapshot();
        return snapshot.status === 'error' ? snapshot.error : null;
    });
    const [unsent, setUnsent] = useState(() => controller.sync.pending().length);

    useEffect(() => {
        let disposed = false;
        // Номер последнего пересчёта: опоздавший ответ старого не затирает новый
        let latest = 0;
        let settleTimer: ReturnType<typeof setTimeout> | null = null;
        const refresh = () => {
            const run = ++latest;
            setUnsent((current) => Math.max(current, controller.sync.pending().length));
            void unsentCount().then(
                (count) => {
                    if (!disposed && run === latest) setUnsent(count);
                },
                () => undefined,
            );
        };
        const onPending = () => {
            refresh();
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = setTimeout(refresh, SYNC_STATUS_SETTLE_MS);
        };
        refresh();
        const unsubscribePending = controller.sync.subscribePending(onPending);
        const unsubscribeState = controller.subscribeSyncState(refresh);
        const poll = setInterval(refresh, SYNC_STATUS_POLL_MS);
        return () => {
            disposed = true;
            unsubscribePending();
            unsubscribeState();
            clearInterval(poll);
            if (settleTimer) clearTimeout(settleTimer);
        };
    }, [controller, unsentCount]);

    const syncNow = useCallback(() => {
        controller.kick();
        void controller.catchUp().catch(() => undefined);
    }, [controller]);

    const value = useMemo<SyncStatusValue>(
        () => ({ connection, error, unsent, loadError, signedInOffline, syncNow }),
        [connection, error, unsent, loadError, signedInOffline, syncNow],
    );

    return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}
