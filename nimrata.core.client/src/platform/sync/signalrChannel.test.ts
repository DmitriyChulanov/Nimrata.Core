import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '@microsoft/signalr';

import { SYNC_HUB_URL, createSignalRChannel } from './signalrChannel';

import type { HubConnectionLike } from './signalrChannel';
import type { PushHandlers } from './syncEngine';

/**
 * Поддельное соединение хаба: тест управляет исходом запуска и событиями сервера
 */
function fakeConnection() {
    const on = new Map<string, (...args: unknown[]) => void>();
    let reconnected: () => void = () => {};
    let reconnectingHandler: () => void = () => {};
    let closed: (error?: Error) => void = () => {};
    const connection = {
        state: 'Disconnected',
        starts: 0,
        stops: 0,
        tokens: [] as string[],
        /** Исход следующего запуска; по умолчанию — успех */
        failNext: null as Error | null,
        tokenFactory: (() => Promise.resolve('')) as () => Promise<string>,
        on(name: string, handler: (...args: unknown[]) => void) {
            on.set(name, handler);
        },
        onreconnected(handler: () => void) {
            reconnected = handler;
        },
        onreconnecting(handler: () => void) {
            reconnectingHandler = handler;
        },
        onclose(handler: (error?: Error) => void) {
            closed = handler;
        },
        async start() {
            connection.starts++;
            connection.tokens.push(await connection.tokenFactory());
            const error = connection.failNext;
            connection.failNext = null;
            if (error) throw error;
            connection.state = 'Connected';
        },
        stop() {
            connection.stops++;
            connection.state = 'Disconnected';
            closed();
            return Promise.resolve();
        },
        /** Сервер вызывает метод клиента */
        emit(name: string, ...args: unknown[]) {
            on.get(name)?.(...args);
        },
        /** Соединение оборвалось, началось автоматическое переподключение */
        reconnecting() {
            connection.state = 'Reconnecting';
            reconnectingHandler();
        },
        /** Автоматическое переподключение удалось */
        reconnect() {
            reconnected();
        },
        /** Соединение закрылось само (переподключение не удалось) */
        drop() {
            connection.state = 'Disconnected';
            closed(new Error('обрыв'));
        },
    };
    return connection;
}

/**
 * Сессия входа с управляемым токеном
 *
 * @param token - начальный токен
 */
function fakeSession(token: string | null) {
    const listeners = new Set<() => void>();
    const session = {
        token,
        refresh: vi.fn(() => {
            session.token = 'refreshed';
            return Promise.resolve(true);
        }),
        setToken(next: string | null) {
            session.token = next;
            for (const listener of listeners) listener();
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
    };
    return session;
}

/**
 * Канал с поддельными соединением, сессией и обработчиками
 *
 * @param token - начальный токен
 */
function setup(token: string | null = 't1') {
    const connection = fakeConnection();
    const session = fakeSession(token);
    const urls: string[] = [];
    const channel = createSignalRChannel({
        getAccessToken: () => session.token,
        subscribeToken: session.subscribe,
        refreshToken: session.refresh,
        createConnection: (url, accessTokenFactory) => {
            urls.push(url);
            connection.tokenFactory = accessTokenFactory;
            return connection as unknown as HubConnectionLike;
        },
    });
    const handlers = {
        connected: vi.fn(),
        changes: vi.fn(),
        resync: vi.fn(),
        disconnected: vi.fn(),
    } satisfies PushHandlers;
    return { connection, session, urls, channel, handlers };
}

/**
 * Неподписанный JWT с заданным сроком
 *
 * @param exp - срок действия, секунды Unix
 */
function jwt(exp: number): string {
    const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
    return `${part({ alg: 'none' })}.${part({ exp })}.`;
}

/**
 * Push-канал SignalR: соединение, переподключение, токен
 */
describe('signalrChannel', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Проверяет, что канал подключается к хабу и сообщает о соединении и сообщениях сервера
     */
    it('start_connectsAndForwardsServerMessages', async () => {
        const { connection, urls, channel, handlers } = setup();

        channel(handlers);
        await vi.advanceTimersByTimeAsync(0);
        connection.emit('changes', { fromSeq: 0, toSeq: 1 });
        connection.emit('resync');

        expect(urls).toEqual([SYNC_HUB_URL]);
        expect(SYNC_HUB_URL).toBe('/api/sync');
        expect(connection.tokens).toEqual(['t1']);
        expect(handlers.connected).toHaveBeenCalledTimes(1);
        expect(handlers.changes).toHaveBeenCalledWith({ fromSeq: 0, toSeq: 1 });
        expect(handlers.resync).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что после автоматического переподключения канал снова сообщает о соединении
     */
    it('reconnected_reportsConnectedAgain', async () => {
        const { connection, channel, handlers } = setup();
        channel(handlers);
        await vi.advanceTimersByTimeAsync(0);

        connection.reconnect();

        expect(handlers.connected).toHaveBeenCalledTimes(2);
    });

    /**
     * Проверяет, что неудачный запуск и обрыв повторяются с задержкой
     */
    it('startFailureOrDrop_retriedWithBackoff', async () => {
        const { connection, channel, handlers } = setup();
        connection.failNext = new Error('нет сети');

        channel(handlers);
        await vi.advanceTimersByTimeAsync(0);
        expect(connection.starts).toBe(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(connection.starts).toBe(2);
        expect(handlers.connected).toHaveBeenCalledTimes(1);

        connection.drop();
        await vi.advanceTimersByTimeAsync(1000);

        expect(connection.starts).toBe(3);
        expect(handlers.connected).toHaveBeenCalledTimes(2);
    });

    /**
     * Проверяет, что переподключение и обрыв открытого соединения сообщаются как потеря связи,
     * а неудачный запуск (SignalR не отличает в нём сеть от ответа сервера) и намеренная
     * остановка (смена токена) — нет
     */
    it('reconnectingOrDrop_reportsDisconnected_startFailureAndStopDoNot', async () => {
        const { connection, session, channel, handlers } = setup();
        connection.failNext = new Error('нет сети');

        channel(handlers);
        await vi.advanceTimersByTimeAsync(0);
        expect(handlers.disconnected).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        connection.reconnecting();
        expect(handlers.disconnected).toHaveBeenCalledTimes(1);
        connection.drop();
        expect(handlers.disconnected).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1000);

        session.setToken('t2');
        await vi.advanceTimersByTimeAsync(0);

        expect(handlers.disconnected).toHaveBeenCalledTimes(2);
    });

    /**
     * Проверяет, что после обновления токена соединение переоткрывается уже с новым токеном
     */
    it('tokenChanged_reconnectsWithNewToken', async () => {
        const { connection, session, channel, handlers } = setup();
        channel(handlers);
        await vi.advanceTimersByTimeAsync(0);

        session.setToken('t2');
        await vi.advanceTimersByTimeAsync(0);

        expect(connection.stops).toBe(1);
        expect(connection.tokens).toEqual(['t1', 't2']);
        expect(handlers.connected).toHaveBeenCalledTimes(2);
    });

    /**
     * Проверяет, что без входа канал не подключается, а после выхода закрывает соединение
     */
    it('noToken_staysDisconnected_logoutStops', async () => {
        const { connection, session, channel, handlers } = setup(null);
        channel(handlers);
        await vi.advanceTimersByTimeAsync(5000);
        expect(connection.starts).toBe(0);

        session.setToken('t1');
        await vi.advanceTimersByTimeAsync(0);
        session.setToken(null);
        await vi.advanceTimersByTimeAsync(5000);

        expect(connection.starts).toBe(1);
        expect(connection.stops).toBe(1);
        expect(connection.state).toBe('Disconnected');
    });

    /**
     * Проверяет, что отказ 401 при запуске обновляет токен и повторяет запуск
     */
    it('unauthorized_refreshesTokenAndRetries', async () => {
        const { connection, session, channel, handlers } = setup();
        connection.failNext = new HttpError('Unauthorized', 401);

        channel(handlers);
        await vi.advanceTimersByTimeAsync(1000);

        expect(session.refresh).toHaveBeenCalledTimes(1);
        expect(connection.tokens.at(-1)).toBe('refreshed');
        expect(handlers.connected).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что истёкший токен обновляется до подключения, а не после отказа
     */
    it('expiredToken_refreshedBeforeConnecting', async () => {
        const { connection, channel, handlers } = setup(jwt(Date.now() / 1000 - 60));

        channel(handlers);
        await vi.advanceTimersByTimeAsync(0);

        expect(connection.tokens).toEqual(['refreshed']);
    });

    /**
     * Проверяет, что отключение канала закрывает соединение и больше его не открывает
     */
    it('dispose_stopsAndDoesNotRestart', async () => {
        const { connection, session, channel, handlers } = setup();
        const stop = channel(handlers);
        await vi.advanceTimersByTimeAsync(0);

        stop();
        await vi.advanceTimersByTimeAsync(0);
        session.setToken('t2');
        await vi.advanceTimersByTimeAsync(5000);

        expect(connection.stops).toBe(1);
        expect(connection.starts).toBe(1);
    });
});
