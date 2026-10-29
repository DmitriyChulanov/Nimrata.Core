/**
 * SyncEngine — сетевая часть синхронизации, отдельная от хранилища. Берёт наборы из очереди
 * хранилища и отправляет их пакетами `POST /api/changesets`: окно от первой правки, не больше
 * одного запроса в полёте, лимит операций в запросе. Итоги пишет в хранилище через `SyncPort`,
 * при сбое сети повторяет запрос с экспоненциальной задержкой, очередь при этом сохраняется.
 * Входящие изменения приходят push-каналом (`PushChannel`, в приложении — SignalR) в формате
 * догона; после каждого соединения и при разрыве курсора движок догоняет `GET /api/changes`,
 * по `resync` — полная загрузка `GET /api/snapshot` с переналожением очереди
 */
import { ApiError } from '@platform/api/apiClient';
import { errorMessage } from '@platform/data/errorMessage';

import type { ApiClient } from '@platform/api/apiClient';
import type {
    ChangesetResult,
    ChangesetTransport,
    SyncPort,
    SyncState,
} from '@platform/data/DataController';
import type {
    ChangesetFailure,
    PendingChangeset,
    RemoteChanges,
    StoreSnapshot,
} from '@platform/data/dataStore';

/** Окно отправки, мс: отсчитывается от первой неотправленной правки, не сдвигается следующими */
export const SYNC_WINDOW_MS = 200;
/** Лимит операций в одном запросе; набор больше лимита уходит целиком отдельным запросом */
export const SYNC_MAX_OPERATIONS = 500;
/** Начальная задержка повтора после сбоя сети, мс; каждая следующая вдвое больше */
export const SYNC_RETRY_BASE_MS = 1000;
/** Наибольшая задержка повтора, мс */
export const SYNC_RETRY_MAX_MS = 30_000;
/**
 * Пауза перед догоном, если подтверждение своего набора пришло с разрывом курсора (были чужие
 * наборы), мс: обычно курсор раньше сдвинет push
 */
export const SYNC_CATCHUP_DELAY_MS = 1000;

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

/** Текст состояния «офлайн»: запрос не дошёл до сервера или push-соединение оборвано */
export const SYNC_OFFLINE_MESSAGE = 'Нет связи с сервером.';

const ONLINE: SyncState = { connection: 'online', error: null };

/**
 * Состояние связи по исключению запроса: ответ сервера — «ошибка», иначе — «офлайн»
 *
 * @param error - исключение запроса
 * @returns состояние для индикатора
 */
function stateOf(error: unknown): SyncState {
    return error instanceof ApiError
        ? { connection: 'error', error: error.message }
        : { connection: 'offline', error: SYNC_OFFLINE_MESSAGE };
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
 * Сообщение push `changes`: формат догона и курсор, после которого сервер прочитал наборы
 */
export interface PushChanges extends RemoteChanges {
    /** Курсор, после которого прочитаны наборы; клиент с меньшим курсором пропустил изменения */
    fromSeq: number;
}

/**
 * Обработчики событий push-канала
 */
export interface PushHandlers {
    /** Соединение установлено (впервые или заново): клиент догоняет и отправляет очередь */
    connected(): void;
    /** Пришли изменения */
    changes(message: PushChanges): void;
    /** Сервер просит перечитать данные целиком */
    resync(): void;
    /** Соединение потеряно (обрыв, неудачный запуск); канал сам переподключается */
    disconnected(): void;
}

/**
 * Push-канал (SignalR в приложении, подделка в тестах): подключается с обработчиками и
 * возвращает функцию отключения. Переподключение — забота канала, о каждом соединении он
 * сообщает через `connected`
 */
export type PushChannel = (handlers: PushHandlers) => () => void;

/**
 * Параметры SyncEngine
 */
export interface SyncEngineOptions {
    /**
     * Push-канал, подключаемый сразу; позже канал подключают `SyncLink.connect`. Без канала
     * изменения других клиентов приходят только догоном
     */
    push?: PushChannel;
}

/**
 * Ответ догона `GET /api/changes`
 */
type CatchUpAnswer = RemoteChanges | { resync: true };

/**
 * Создаёт SyncEngine для `DataControllerOptions.transport`
 *
 * @param api - API-клиент
 * @param options - push-канал
 * @returns сетевая часть: подключается к хранилищу и возвращает управление ею
 */
export function createSyncEngine(
    api: ApiClient,
    options: SyncEngineOptions = {},
): ChangesetTransport {
    return (port) => {
        let disposed = false;
        // Наборы запроса в полёте и ожидание его завершения (`true` — ответ получен); `null` — запроса нет
        let inFlight: ReadonlySet<string> | null = null;
        let inFlightDone: Promise<boolean> | null = null;
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

        // Данные уже загружены (полная загрузка или явный догон): до этого push не применяется
        let ready = false;
        // Идущая полная загрузка; повторный запрос во время неё — ещё один круг
        let resyncing: Promise<void> | null = null;
        let resyncAgain = false;
        // Во время полной загрузки приходил push: после неё — догон
        let catchUpAfterResync = false;
        let resyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
        let resyncAttempt = 0;
        // Идущий догон; push или повторный запрос во время него — ещё один круг
        let catchingUp: Promise<void> | null = null;
        let catchUpAgain = false;
        // Догон по разрыву курсора после подтверждения: таймер и курсор, до которого ждём
        let gapTimer: ReturnType<typeof setTimeout> | null = null;
        let gapSeq = 0;
        // Полную загрузку запросил сервер: после неё — сигнал `onResync`
        let notifyResync = false;
        const resyncListeners = new Set<() => void>();
        // Состояние связи для индикатора
        let state: SyncState = ONLINE;
        const stateListeners = new Set<() => void>();

        const setState = (next: SyncState) => {
            if (disposed || (next.connection === state.connection && next.error === state.error)) {
                return;
            }
            state = next;
            for (const listener of [...stateListeners]) listener();
        };

        /**
         * Запрос с учётом состояния связи: удача — «онлайн», исключение — «офлайн» или «ошибка»
         *
         * @param run - запрос
         * @returns ответ запроса; исключение пробрасывается
         */
        const tracked = async <T>(run: Promise<T>): Promise<T> => {
            try {
                const result = await run;
                setState(ONLINE);
                return result;
            } catch (error) {
                setState(stateOf(error));
                throw error;
            }
        };

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
            if (disposed || inFlight || retryTimer || resyncing || !due) return;
            const queue = unsent();
            const batch = takeBatch(queue, SYNC_MAX_OPERATIONS);
            // Остаток сверх лимита — из того же окна, уходит сразу следом
            due = batch.length < queue.length;
            if (batch.length === 0) return;
            void send(batch);
        };

        /**
         * Подтверждение пришло с разрывом курсора (между своими наборами есть чужие): если push
         * не сдвинет курсор за паузу, догоняем сами
         *
         * @param seq - наибольший курсор подтверждённых наборов
         */
        const watchGap = (seq: number) => {
            if (seq <= port.getSeq()) return;
            gapSeq = Math.max(gapSeq, seq);
            if (gapTimer) return;
            gapTimer = setTimeout(() => {
                gapTimer = null;
                if (port.getSeq() < gapSeq) void catchUp().catch(() => undefined);
            }, SYNC_CATCHUP_DELAY_MS);
        };

        const send = (batch: readonly PendingChangeset[]): Promise<boolean> => {
            inFlight = new Set(batch.map((c) => c.id));
            const done = request(batch);
            inFlightDone = done;
            return done;
        };

        const request = async (batch: readonly PendingChangeset[]): Promise<boolean> => {
            let results: unknown;
            try {
                results = await tracked(
                    api.post<ChangesetResult[]>('changesets', {
                        changesets: batch.map((c) => ({ id: c.id, operations: c.operations })),
                    }),
                );
            } catch (error) {
                inFlight = null;
                if (disposed) return false;
                if (isRetryable(error)) {
                    // Наборы остаются в очереди; повтор возьмёт и накопившиеся
                    due = true;
                    const delay = Math.min(SYNC_RETRY_BASE_MS * 2 ** attempt, SYNC_RETRY_MAX_MS);
                    attempt++;
                    if (retryTimer) clearTimeout(retryTimer);
                    retryTimer = setTimeout(() => {
                        retryTimer = null;
                        flush();
                    }, delay);
                    return false;
                }
                attempt = 0;
                const failure = failureOf(error);
                for (const changeset of batch) settled.add(changeset.id);
                for (const changeset of batch) port.reject(changeset.id, failure);
                flush();
                startWindow();
                return true;
            }
            if (disposed) return false;
            attempt = 0;
            const byId = new Map<string, ChangesetResult>();
            if (Array.isArray(results)) {
                for (const result of results as ChangesetResult[]) byId.set(result.id, result);
            }
            for (const changeset of batch) settled.add(changeset.id);
            inFlight = null;
            // Итоги — строго в порядке очереди, независимо от порядка в ответе
            let maxSeq = 0;
            for (const changeset of batch) {
                const result = byId.get(changeset.id);
                settle(port, changeset.id, result);
                if (result?.status !== 'rejected') maxSeq = Math.max(maxSeq, result?.seq ?? 0);
            }
            watchGap(maxSeq);
            flush();
            startWindow();
            return true;
        };

        /**
         * Отправляет всё неотправленное сразу и ждёт ответов; на сбое сети останавливается
         */
        const drain = async () => {
            while (!disposed) {
                if (inFlightDone && inFlight) {
                    await inFlightDone;
                    continue;
                }
                const queue = unsent();
                if (queue.length === 0) return;
                if (windowTimer) clearTimeout(windowTimer);
                if (retryTimer) clearTimeout(retryTimer);
                windowTimer = null;
                retryTimer = null;
                if (!(await send(takeBatch(queue, SYNC_MAX_OPERATIONS)))) return;
            }
        };

        const resync = (): Promise<void> => {
            if (resyncing) {
                resyncAgain = true;
                return resyncing;
            }
            const run = async () => {
                let notify: boolean;
                try {
                    do {
                        resyncAgain = false;
                        // Снимок уже содержит отправленное: переналагаем только то, чего на
                        // сервере ещё нет, иначе применённое повторилось бы поверх снимка
                        await drain();
                        const snapshot = await tracked(api.get<StoreSnapshot>('snapshot'));
                        if (disposed) return;
                        port.reset(snapshot);
                        ready = true;
                        resyncAttempt = 0;
                    } while (resyncAgain && !disposed);
                    notify = notifyResync;
                    notifyResync = false;
                } finally {
                    resyncing = null;
                    flush();
                    startWindow();
                }
                if (notify && !disposed) for (const listener of [...resyncListeners]) listener();
                if (catchUpAfterResync && !disposed) {
                    catchUpAfterResync = false;
                    void catchUp().catch(() => undefined);
                }
            };
            resyncing = run();
            return resyncing;
        };

        /**
         * Полная загрузка по сигналу сервера; при сбое — повтор с экспоненциальной задержкой
         */
        const requestResync = () => {
            if (resyncRetryTimer) clearTimeout(resyncRetryTimer);
            resyncRetryTimer = null;
            resync().catch(() => {
                if (disposed) return;
                const delay = Math.min(SYNC_RETRY_BASE_MS * 2 ** resyncAttempt, SYNC_RETRY_MAX_MS);
                resyncAttempt++;
                resyncRetryTimer = setTimeout(requestResync, delay);
            });
        };

        const catchUp = (): Promise<void> => {
            ready = true;
            if (resyncing) {
                catchUpAfterResync = true;
                return resyncing;
            }
            if (catchingUp) {
                catchUpAgain = true;
                return catchingUp;
            }
            const run = async () => {
                try {
                    do {
                        catchUpAgain = false;
                        const answer = await tracked(
                            api.get<CatchUpAnswer>(`changes?since=${port.getSeq()}`),
                        );
                        if (disposed) return;
                        if ('resync' in answer) {
                            catchingUp = null;
                            notifyResync = true;
                            await resync();
                            return;
                        }
                        port.applyRemote(answer);
                    } while (catchUpAgain && !disposed);
                } finally {
                    catchingUp = null;
                }
            };
            catchingUp = run();
            return catchingUp;
        };

        const kick = () => {
            if (disposed) return;
            attempt = 0;
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = null;
            if (unsent().length > 0) due = true;
            flush();
        };

        const handlers: PushHandlers = {
            connected() {
                if (disposed) return;
                setState(ONLINE);
                if (!ready) return;
                void catchUp().catch(() => undefined);
                kick();
            },
            changes(message) {
                if (disposed || !ready) return;
                if (resyncing) {
                    catchUpAfterResync = true;
                } else if (catchingUp) {
                    catchUpAgain = true;
                } else if (message.fromSeq > port.getSeq()) {
                    // Пропущены наборы между курсором клиента и началом сообщения
                    void catchUp().catch(() => undefined);
                } else {
                    port.applyRemote(message);
                }
            },
            resync() {
                if (disposed || (!resyncing && !ready)) return;
                notifyResync = true;
                if (resyncing) resyncAgain = true;
                else requestResync();
            },
            disconnected() {
                setState({ connection: 'offline', error: SYNC_OFFLINE_MESSAGE });
            },
        };

        const unsubscribe = port.subscribePending(startWindow);
        const channels = new Set<() => void>();
        const connect = (channel: PushChannel) => {
            if (disposed) return () => {};
            const stop = channel(handlers);
            let open = true;
            const disconnect = () => {
                if (!open) return;
                open = false;
                channels.delete(disconnect);
                stop();
            };
            channels.add(disconnect);
            return disconnect;
        };
        if (options.push) connect(options.push);
        startWindow();
        return {
            resync,
            catchUp,
            kick,
            connect,
            getState: () => state,
            subscribeState(listener) {
                stateListeners.add(listener);
                return () => void stateListeners.delete(listener);
            },
            onResync(listener) {
                resyncListeners.add(listener);
                return () => void resyncListeners.delete(listener);
            },
            dispose() {
                disposed = true;
                unsubscribe();
                for (const disconnect of [...channels]) disconnect();
                for (const timer of [windowTimer, retryTimer, resyncRetryTimer, gapTimer]) {
                    if (timer) clearTimeout(timer);
                }
            },
        };
    };
}
