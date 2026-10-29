import { describe, expect, it } from 'vitest';

import { describeSyncStatus, unsentLabel } from './syncStatus';

import type { SyncStatusInput } from './syncStatus';

const base: SyncStatusInput = {
    connection: 'online',
    error: null,
    unsent: 0,
    loadError: null,
    signedInOffline: false,
};

/**
 * Состояние индикатора синхронизации по связи, очереди и загрузке
 */
describe('syncStatus', () => {
    /**
     * Проверяет, что при связи и пустой очереди всё синхронизировано
     */
    it('describe_onlineNothingUnsent_synced', () => {
        expect(describeSyncStatus(base)).toMatchObject({
            kind: 'synced',
            label: 'Синхронизировано',
            icon: 'cloud-check',
        });
    });

    /**
     * Проверяет, что неотправленные наборы показываются числом
     */
    it('describe_unsent_countInLabel', () => {
        const view = describeSyncStatus({ ...base, unsent: 3 });

        expect(view).toMatchObject({ kind: 'unsent', label: '3 неотправленных' });
        expect(view.detail).toContain('3');
    });

    /**
     * Проверяет, что без сети (запрос или push) — «офлайн», и подсказка называет число
     * неотправленных; то же, если вход не проверен из-за сети
     */
    it('describe_offline_offlineWithUnsentInDetail', () => {
        const view = describeSyncStatus({
            ...base,
            connection: 'offline',
            error: 'Нет связи с сервером.',
            unsent: 2,
        });

        expect(view).toMatchObject({ kind: 'offline', label: 'Офлайн', icon: 'cloud-slash' });
        expect(view.detail).toContain('Неотправленных изменений: 2');
        expect(describeSyncStatus({ ...base, signedInOffline: true }).kind).toBe('offline');
    });

    /**
     * Проверяет, что сбой сервера или загрузки — «ошибка» с причиной в подсказке; офлайн важнее
     */
    it('describe_serverOrLoadError_errorWithReason', () => {
        const server = describeSyncStatus({
            ...base,
            connection: 'error',
            error: 'Сервер недоступен.',
        });
        const load = describeSyncStatus({ ...base, loadError: 'Не удалось загрузить данные.' });

        expect(server).toMatchObject({ kind: 'error', label: 'Ошибка', icon: 'cloud-warning' });
        expect(server.detail).toContain('Сервер недоступен.');
        expect(load.detail).toContain('Не удалось загрузить данные.');
        expect(describeSyncStatus({ ...base, connection: 'offline', loadError: 'сбой' }).kind).toBe(
            'offline',
        );
    });

    /**
     * Проверяет согласование слова с числом
     */
    it('unsentLabel_agreesWithNumber', () => {
        expect(unsentLabel(1)).toBe('1 неотправленное');
        expect(unsentLabel(21)).toBe('21 неотправленное');
        expect(unsentLabel(11)).toBe('11 неотправленных');
        expect(unsentLabel(2)).toBe('2 неотправленных');
        expect(unsentLabel(5)).toBe('5 неотправленных');
    });
});
