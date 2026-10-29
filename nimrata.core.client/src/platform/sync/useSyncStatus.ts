import { useContext } from 'react';

import { SyncStatusContext } from './SyncStatusContext';

import type { SyncStatusValue } from './SyncStatusContext';

/**
 * Состояние синхронизации: связь, неотправленные наборы всех вкладок, ошибка загрузки
 *
 * @returns значение контекста состояния синхронизации; `null` вне `SyncStatusProvider`
 */
export function useSyncStatus(): SyncStatusValue | null {
    return useContext(SyncStatusContext);
}
