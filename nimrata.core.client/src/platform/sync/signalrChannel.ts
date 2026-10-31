/**
 * Push-канал SyncEngine поверх SignalR: соединение с хабом `/api/sync`, автоматическое
 * переподключение, переподключение после обновления токена и повтор запуска с задержкой
 */
import { HttpError, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';

import { isRemoteChanges } from '@platform/data/dataGuards';

import { retryDelay } from './retryDelay';

import type { PushChanges, PushChannel } from './syncEngine';

/**
 * Адрес хаба синхронизации (под общим префиксом `/api`, проксируется Vite с `ws: true`); на сервере —
 * `SyncHub.Path` (`Nimrata.Core.Server/Sync/SyncHub.cs`)
 */
export const SYNC_HUB_URL = '/api/sync';

/**
 * Часть соединения SignalR, которой пользуется канал (подменяется в тестах)
 */
export interface HubConnectionLike {
    /** Состояние: `Disconnected`, `Connecting`, `Connected`, `Disconnecting`, `Reconnecting` */
    readonly state: string;
    on(name: string, handler: (...args: never[]) => void): void;
    onreconnected(handler: () => void): void;
    onreconnecting(handler: (error?: Error) => void): void;
    onclose(handler: (error?: Error) => void): void;
    start(): Promise<void>;
    stop(): Promise<void>;
}

/**
 * Параметры канала
 */
export interface SignalRChannelOptions {
    /** Текущий access-токен; `null` — не вошли, соединения нет */
    getAccessToken(): string | null;
    /** Подписка на изменения сессии (новый токен, выход); возвращает отписку */
    subscribeToken(listener: () => void): () => void;
    /** Обновляет токен (refresh-cookie): при отказе 401 и перед подключением с истёкшим токеном */
    refreshToken?(): Promise<boolean>;
    /** Адрес хаба; по умолчанию `SYNC_HUB_URL` */
    url?: string;
    /** Создание соединения (для тестов); по умолчанию — `HubConnectionBuilder` */
    createConnection?(url: string, accessTokenFactory: () => Promise<string>): HubConnectionLike;
}

/**
 * Имена сообщений хаба; сервер отправляет их из `ChangeDispatcher` (`ChangesMessage`, `ResyncMessage`)
 */
export const SYNC_HUB_MESSAGES = { changes: 'changes', resync: 'resync' } as const;

/**
 * Проверяет, что тело сообщения `changes` — формат догона с курсором `fromSeq`
 *
 * @param value - аргумент сообщения хаба
 * @returns `true`, если форма подходит
 */
function isPushChanges(value: unknown): value is PushChanges {
    return (
        isRemoteChanges(value) &&
        'fromSeq' in value &&
        typeof value.fromSeq === 'number' &&
        Number.isInteger(value.fromSeq)
    );
}

/**
 * Истёк ли JWT (по полю `exp`); токен без читаемого срока считается действующим
 *
 * @param token - access-токен
 * @returns `true`, если срок прошёл
 */
function isExpired(token: string): boolean {
    try {
        const payload = token.split('.')[1] ?? '';
        const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
        const exp = (JSON.parse(json) as { exp?: unknown }).exp;
        return typeof exp === 'number' && exp * 1000 <= Date.now();
    } catch {
        return false;
    }
}

/**
 * Соединение SignalR по умолчанию: токен в query (браузер не шлёт заголовки в WebSocket),
 * бесконечное автоматическое переподключение с экспоненциальной задержкой
 *
 * @param url - адрес хаба
 * @param accessTokenFactory - токен для каждого (пере)подключения
 * @returns соединение
 */
function buildConnection(
    url: string,
    accessTokenFactory: () => Promise<string>,
): HubConnectionLike {
    return (
        new HubConnectionBuilder()
            // Адрес абсолютный: SignalR сам разрешает относительный только в «настоящем» браузере
            .withUrl(new URL(url, window.location.href).href, { accessTokenFactory })
            .configureLogging(LogLevel.Warning)
            .withAutomaticReconnect({
                nextRetryDelayInMilliseconds: ({ previousRetryCount }) =>
                    retryDelay(previousRetryCount),
            })
            .build()
    );
}

/**
 * Создаёт push-канал SignalR
 *
 * @param options - токен, его обновление и подмена соединения
 * @returns канал для `createSyncEngine({ push })` или `DataController.connectPush`
 */
export function createSignalRChannel(options: SignalRChannelOptions): PushChannel {
    return (handlers) => {
        let disposed = false;
        // Токен, с которым открыто (или открывается) соединение
        let usedToken: string | null = null;
        // Идёт намеренная остановка: её закрытие не перезапускаем
        let stopping = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let attempt = 0;
        // Запуски и остановки выполняются строго по очереди
        let chain: Promise<void> = Promise.resolve();

        const accessTokenFactory = async (): Promise<string> => {
            let token = options.getAccessToken();
            if (token && isExpired(token) && options.refreshToken) {
                await options.refreshToken();
                token = options.getAccessToken();
            }
            usedToken = token;
            return token ?? '';
        };

        const connection = (options.createConnection ?? buildConnection)(
            options.url ?? SYNC_HUB_URL,
            accessTokenFactory,
        );
        connection.on(SYNC_HUB_MESSAGES.changes, (message: unknown) => {
            // Сообщение неверной формы применить нельзя, а пропустить — значит потерять изменения:
            // клиент перечитывает данные целиком
            if (isPushChanges(message)) handlers.changes(message);
            else handlers.resync();
        });
        connection.on(SYNC_HUB_MESSAGES.resync, () => handlers.resync());
        connection.onreconnected(() => {
            attempt = 0;
            handlers.connected();
        });
        connection.onreconnecting(() => {
            if (!disposed) handlers.disconnected();
        });
        connection.onclose(() => {
            if (disposed || stopping) return;
            handlers.disconnected();
            scheduleStart();
        });

        const serial = (step: () => Promise<void>) => {
            chain = chain.then(step).catch(() => undefined);
            return chain;
        };

        const start = () =>
            serial(async () => {
                if (disposed || connection.state !== 'Disconnected') return;
                if (!options.getAccessToken()) return;
                try {
                    await connection.start();
                } catch (error) {
                    if (disposed) return;
                    if (error instanceof HttpError && error.statusCode === 401) {
                        await options.refreshToken?.();
                    }
                    // Неудачный запуск не сообщается как потеря связи: SignalR не отличает в
                    // нём отсутствие сети от ответа сервера; без сети это покажут запросы
                    // догона и отправки
                    scheduleStart();
                    return;
                }
                attempt = 0;
                if (!disposed) handlers.connected();
            });

        const stop = () =>
            serial(async () => {
                if (connection.state === 'Disconnected') return;
                stopping = true;
                try {
                    await connection.stop();
                } finally {
                    stopping = false;
                }
            });

        function scheduleStart() {
            if (disposed || retryTimer) return;
            retryTimer = setTimeout(() => {
                retryTimer = null;
                void start();
            }, retryDelay(attempt));
            attempt++;
        }

        const unsubscribe = options.subscribeToken(() => {
            const token = options.getAccessToken();
            if (disposed || token === usedToken) return;
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = null;
            attempt = 0;
            usedToken = token;
            // Токен обновлён — переподключаемся с ним; выход — закрываем соединение
            void stop().then(() => (token ? start() : undefined));
        });

        void start();
        return () => {
            disposed = true;
            unsubscribe();
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = null;
            void stop();
        };
    };
}
