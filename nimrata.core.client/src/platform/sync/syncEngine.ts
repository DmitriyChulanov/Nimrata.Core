/**
 * SyncEngine — сетевая часть синхронизации, отдельная от хранилища. Берёт наборы из очереди
 * хранилища и отправляет их пакетами `POST /api/changesets`: окно от первой правки, не больше
 * одного запроса в полёте, лимит операций в запросе. Итоги пишет в хранилище через `SyncPort`,
 * при сбое сети повторяет запрос с экспоненциальной задержкой, очередь при этом сохраняется
 */
import { ApiError } from '@platform/api/apiClient';
import { errorMessage } from '@platform/data/errorMessage';

import type { ApiClient } from '@platform/api/apiClient';
import type { ChangesetResult, ChangesetTransport, SyncPort } from '@platform/data/DataController';
import type { ChangesetFailure, PendingChangeset } from '@platform/data/dataStore';

/** Окно отправки, мс: отсчитывается от первой неотправленной правки, не сдвигается следующими */
export const SYNC_WINDOW_MS = 200;
/** Лимит операций в одном запросе; набор больше лимита уходит целиком отдельным запросом */
export const SYNC_MAX_OPERATIONS = 500;
/** Начальная задержка повтора после сбоя сети, мс; каждая следующая вдвое больше */
export const SYNC_RETRY_BASE_MS = 1000;
/** Наибольшая задержка повтора, мс */
export const SYNC_RETRY_MAX_MS = 30_000;

/**
 * Можно ли повторить запрос после ошибки: сеть, сбой сервера, таймаут, перегрузка и истёкший
 * вход — очередь сохраняется. Остальные ответы 4xx (формат запроса) отклоняют наборы пакета
 *
 * @param error - исключение запроса
 * @returns `true`, если наборы надо оставить в очереди и повторить
 */
function isRetryable(error: unknown): boolean {
    if (!(error instanceof ApiError)) return true;
    return error.status >= 500 || [401, 408, 429].includes(error.status);
}

/**
 * Причина отказа наборов пакета по исключению запроса
 *
 * @param error - исключение запроса
 * @returns причина для `SyncPort.reject`
 */
function failureOf(error: unknown): ChangesetFailure {
    return error instanceof ApiError
        ? {
              error: error.message,
              status: error.status,
              ...(error.code ? { code: error.code } : {}),
          }
        : { error: errorMessage(error) };
}

/**
 * Итог набора: подтверждение или отказ в хранилище
 *
 * @param port - вход хранилища
 * @param id - идентификатор набора
 * @param result - итог из ответа сервера; нет — сервер набор пропустил
 */
function settle(port: SyncPort, id: string, result: ChangesetResult | undefined): void {
    if (!result) {
        port.reject(id, { error: 'Сервер не вернул итог набора.' });
    } else if (result.status === 'rejected') {
        port.reject(id, {
            error: result.detail ?? 'Набор изменений отклонён.',
            status: 422,
            ...(result.code ? { code: result.code } : {}),
        });
    } else {
        port.confirm(id, result.seq ?? 0);
    }
}

/**
 * Берёт из начала очереди пакет по лимиту операций, не разрывая наборы. Первый набор берётся
 * всегда, даже если он один больше лимита
 *
 * @param queue - неотправленные наборы в порядке очереди
 * @param limit - лимит операций в запросе
 * @returns наборы пакета
 */
function takeBatch(queue: readonly PendingChangeset[], limit: number): PendingChangeset[] {
    const batch: PendingChangeset[] = [];
    let operations = 0;
    for (const changeset of queue) {
        const size = changeset.operations.length;
        if (batch.length > 0 && operations + size > limit) break;
        batch.push(changeset);
        operations += size;
    }
    return batch;
}

/**
 * Создаёт SyncEngine для `DataControllerOptions.transport`
 *
 * @param api - API-клиент
 * @returns сетевая часть: подключается к хранилищу, возвращает функцию отключения
 */
export function createSyncEngine(api: ApiClient): ChangesetTransport {
    return (port) => {
        let disposed = false;
        // Наборы запроса в полёте; `null` — запроса нет
        let inFlight: ReadonlySet<string> | null = null;
        // Таймер окна: запущен первой неотправленной правкой
        let windowTimer: ReturnType<typeof setTimeout> | null = null;
        // Окно истекло: неотправленные наборы уходят при первой возможности
        let due = false;
        // Таймер повтора после сбоя и номер попытки для задержки
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let attempt = 0;
        // Наборы с итогом, которые хранилище ещё не убрало из очереди (итог отложен открытой
        // локальной правкой): повторно их не отправляем
        const settled = new Set<string>();

        const unsent = () =>
            port.pending().filter((c) => !inFlight?.has(c.id) && !settled.has(c.id));

        const startWindow = () => {
            if (settled.size > 0) {
                const queued = new Set(port.pending().map((c) => c.id));
                for (const id of settled) if (!queued.has(id)) settled.delete(id);
            }
            if (disposed || due || windowTimer || unsent().length === 0) return;
            windowTimer = setTimeout(() => {
                windowTimer = null;
                due = true;
                flush();
            }, SYNC_WINDOW_MS);
        };

        const flush = () => {
            if (disposed || inFlight || retryTimer || !due) return;
            const queue = unsent();
            const batch = takeBatch(queue, SYNC_MAX_OPERATIONS);
            // Остаток сверх лимита — из того же окна, уходит сразу следом
            due = batch.length < queue.length;
            if (batch.length === 0) return;
            void send(batch);
        };

        const send = async (batch: readonly PendingChangeset[]) => {
            inFlight = new Set(batch.map((c) => c.id));
            let results: unknown;
            try {
                results = await api.post<ChangesetResult[]>('changesets', {
                    changesets: batch.map((c) => ({ id: c.id, operations: c.operations })),
                });
            } catch (error) {
                inFlight = null;
                if (disposed) return;
                if (isRetryable(error)) {
                    // Наборы остаются в очереди; повтор возьмёт и накопившиеся
                    due = true;
                    const delay = Math.min(SYNC_RETRY_BASE_MS * 2 ** attempt, SYNC_RETRY_MAX_MS);
                    attempt++;
                    retryTimer = setTimeout(() => {
                        retryTimer = null;
                        flush();
                    }, delay);
                    return;
                }
                attempt = 0;
                const failure = failureOf(error);
                for (const changeset of batch) settled.add(changeset.id);
                for (const changeset of batch) port.reject(changeset.id, failure);
                flush();
                startWindow();
                return;
            }
            if (disposed) return;
            attempt = 0;
            const byId = new Map<string, ChangesetResult>();
            if (Array.isArray(results)) {
                for (const result of results as ChangesetResult[]) byId.set(result.id, result);
            }
            for (const changeset of batch) settled.add(changeset.id);
            inFlight = null;
            // Итоги — строго в порядке очереди, независимо от порядка в ответе
            for (const changeset of batch) settle(port, changeset.id, byId.get(changeset.id));
            flush();
            startWindow();
        };

        const unsubscribe = port.subscribePending(startWindow);
        startWindow();
        return () => {
            disposed = true;
            unsubscribe();
            if (windowTimer) clearTimeout(windowTimer);
            if (retryTimer) clearTimeout(retryTimer);
        };
    };
}
