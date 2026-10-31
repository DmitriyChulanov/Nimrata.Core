/** Начальная задержка повтора после сбоя сети, мс; каждая следующая вдвое больше */
export const SYNC_RETRY_BASE_MS = 1000;
/** Наибольшая задержка повтора, мс */
export const SYNC_RETRY_MAX_MS = 30_000;

/**
 * Задержка повтора синхронизации: экспоненциально от `SYNC_RETRY_BASE_MS` до `SYNC_RETRY_MAX_MS`;
 * общая для отправки очереди, полной загрузки и подключения push-канала
 *
 * @param attempt - номер попытки с нуля
 * @returns задержка, мс
 */
export function retryDelay(attempt: number): number {
    return Math.min(SYNC_RETRY_BASE_MS * 2 ** attempt, SYNC_RETRY_MAX_MS);
}
