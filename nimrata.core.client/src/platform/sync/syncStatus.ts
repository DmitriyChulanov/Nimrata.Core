/**
 * Состояние индикатора синхронизации: из связи сетевой части, числа неотправленных наборов и
 * итога загрузки данных — вид, короткая подпись, подсказка и иконка
 */
import type { SyncConnection } from '@platform/data/DataController';

/**
 * Вид индикатора: `synced` — всё на сервере, `unsent` — есть неотправленные, `offline` — нет
 * связи, `error` — сервер ответил сбоем или данные не загрузились
 */
export type SyncIndicatorKind = 'synced' | 'unsent' | 'offline' | 'error';

/**
 * Исходные данные индикатора
 */
export interface SyncStatusInput {
    /** Связь сетевой части с сервером */
    connection: SyncConnection;
    /** Текст последней ошибки сетевой части; `null` — нет */
    error: string | null;
    /** Неотправленные наборы всех вкладок */
    unsent: number;
    /** Ошибка загрузки данных (`DataSnapshot.status === 'error'`); `null` — нет */
    loadError: string | null;
    /** Вход не проверен из-за отсутствия сети (`AuthStatus` `'offline'`) */
    signedInOffline: boolean;
}

/**
 * Что показывает индикатор
 */
export interface SyncStatusView {
    /** Вид */
    kind: SyncIndicatorKind;
    /** Короткая подпись в шапке */
    label: string;
    /** Подробности для подсказки */
    detail: string;
    /** Имя иконки реестра */
    icon: string;
}

/**
 * Подпись «N неотправленных» с согласованием по числу
 *
 * @param count - число неотправленных наборов
 * @returns подпись, например «1 неотправленное», «5 неотправленных»
 */
export function unsentLabel(count: number): string {
    const one = count % 10 === 1 && count % 100 !== 11;
    return `${count} ${one ? 'неотправленное' : 'неотправленных'}`;
}

/**
 * Состояние индикатора; приоритет: офлайн, ошибка, неотправленные, синхронизировано
 *
 * @param input - связь, очередь и загрузка
 * @returns вид, подпись, подсказка и иконка
 */
export function describeSyncStatus(input: SyncStatusInput): SyncStatusView {
    const { connection, error, unsent, loadError, signedInOffline } = input;
    const queued = unsent > 0 ? ` Неотправленных изменений: ${unsent}.` : '';
    if (connection === 'offline' || signedInOffline) {
        const reason = signedInOffline
            ? 'Нет связи с сервером, вход не проверен.'
            : (error ?? 'Нет связи с сервером.');
        return {
            kind: 'offline',
            label: 'Офлайн',
            icon: 'cloud-slash',
            detail: `${reason} Изменения сохраняются на устройстве и отправятся, когда связь вернётся.${queued}`,
        };
    }
    const reason = connection === 'error' ? (error ?? 'сбой сервера.') : loadError;
    if (reason !== null) {
        return {
            kind: 'error',
            label: 'Ошибка',
            icon: 'cloud-warning',
            detail: `Ошибка синхронизации: ${reason}${queued}`,
        };
    }
    if (unsent > 0) {
        return {
            kind: 'unsent',
            label: unsentLabel(unsent),
            icon: 'cloud-arrow-up',
            detail: `Изменения ждут отправки на сервер (во всех вкладках): ${unsent}.`,
        };
    }
    return {
        kind: 'synced',
        label: 'Синхронизировано',
        icon: 'cloud-check',
        detail: 'Все изменения сохранены на сервере.',
    };
}
