import { createContext } from 'react';

import type { SyncConnection } from '@platform/data/DataController';

/**
 * Значение контекста состояния синхронизации: связь сетевой части, неотправленные наборы всех
 * вкладок и итог загрузки данных
 */
export interface SyncStatusValue {
    /** Связь сетевой части с сервером */
    connection: SyncConnection;
    /** Текст последней ошибки сетевой части; `null` — нет */
    error: string | null;
    /** Неотправленные наборы: своя очередь и очереди всех вкладок в IndexedDB */
    unsent: number;
    /** Ошибка загрузки данных; `null` — нет */
    loadError: string | null;
    /** Вход не проверен из-за отсутствия сети */
    signedInOffline: boolean;
    /** Синхронизировать сейчас: отправить очередь без задержки повтора и догнать сервер */
    syncNow(): void;
}

/**
 * Контекст состояния синхронизации; `null` — вне `SyncStatusProvider`
 */
export const SyncStatusContext = createContext<SyncStatusValue | null>(null);
