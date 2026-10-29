import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { openOfflineDb, rememberedUser } from '@platform';

import { App } from './App';

const types = [
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'name', name: 'Название', kind: 'string' }],
    },
];

const objects = [{ id: 'n1', type: 'Note', parent: null, number: 0, properties: { name: 'Идея' } }];

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Состояние подставного сервера: сеть, обновление входа, приём наборов
 */
interface ServerState {
    /** Сети нет: каждый запрос падает */
    offline: boolean;
    /** Ответ обновления входа: токен, отказ (вход истёк) или сбой сети */
    refresh: 'ok' | 'expired' | 'network';
    /** Ответ на отправку наборов: принять или 401 */
    changesets: 'ok' | 401;
    /** Принятые наборы */
    posted: { id: string; operations: unknown[] }[];
}

/**
 * Подставной сервер на `fetch`
 */
function stubServer(): ServerState {
    const state: ServerState = { offline: false, refresh: 'ok', changesets: 'ok', posted: [] };
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
            if (state.offline) throw new TypeError('Failed to fetch');
            if (url === '/api/auth/refresh') {
                if (state.refresh === 'network') throw new TypeError('Failed to fetch');
                return state.refresh === 'ok'
                    ? jsonResponse({ accessToken: 'tok' })
                    : new Response(null, { status: 401 });
            }
            if (url === '/api/auth/login') return jsonResponse({ accessToken: 'tok' });
            if (url === '/api/auth/logout') return new Response(null, { status: 204 });
            if (url === '/api/auth/me') return jsonResponse({ id: 'u1', isAdmin: false });
            if (url === '/api/snapshot') return jsonResponse({ seq: 0, types, objects });
            if (url === '/api/extensions') return jsonResponse([]);
            if (url.startsWith('/api/changes?since=')) {
                return jsonResponse({ toSeq: 0, changesetIds: [], upserts: [], deletes: [] });
            }
            if (url === '/api/changesets') {
                if (state.changesets === 401) return new Response(null, { status: 401 });
                const body = JSON.parse(String(init?.body)) as {
                    changesets: ServerState['posted'];
                };
                const results = body.changesets.map((c) => {
                    state.posted.push(c);
                    return { id: c.id, status: 'applied', seq: state.posted.length };
                });
                return jsonResponse(results);
            }
            return new Response(null, { status: 404 });
        }),
    );
    return state;
}

let indexedDB: IDBFactory;

beforeEach(() => {
    indexedDB = new IDBFactory();
    vi.stubGlobal('indexedDB', indexedDB);
});

afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
});

/**
 * Переименовывает выделенную заметку в панели свойств
 */
async function rename(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
    await user.click(await screen.findByRole('treeitem', { name: from }));
    const field = within(screen.getByRole('region', { name: 'Свойства' })).getByLabelText(
        'Название',
    );
    await user.clear(field);
    await user.type(field, `${to}{Enter}`);
}

/**
 * Ждёт, пока в базе пользователя появится снимок
 */
async function waitForCachedSnapshot() {
    await waitFor(async () => {
        const db = await openOfflineDb('u1', { indexedDB });
        const snapshot = await db.readSnapshot();
        db.close();
        expect(snapshot).toBeDefined();
    });
}

/**
 * Проверяет старт без сети: после прошлого входа приложение открывается из кэша IndexedDB
 */
it('app_offlineStart_showsCachedDataOfRememberedUser', async () => {
    stubServer();
    const first = render(<App />);
    expect(await screen.findByRole('treeitem', { name: 'Идея' })).toBeInTheDocument();
    await waitForCachedSnapshot();
    first.unmount();

    stubServer().offline = true;
    render(<App />);

    expect(await screen.findByRole('treeitem', { name: 'Идея' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
});

/**
 * Проверяет выход с неотправленными изменениями: предупреждение, затем база пользователя удаляется
 */
it('app_logoutWithUnsentChanges_warnsThenDeletesDatabase', async () => {
    const server = stubServer();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('treeitem', { name: 'Идея' });
    await waitForCachedSnapshot();
    server.offline = true;
    await rename(user, 'Идея', 'Офлайн');

    await user.click(screen.getByRole('button', { name: 'Выйти' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Изменения ещё не отправлены на сервер (1)');
    server.offline = false;
    await user.click(within(dialog).getByRole('button', { name: 'Выйти' }));

    await waitFor(() => expect(screen.getByLabelText('Пароль')).toBeInTheDocument());
    expect(server.posted).toEqual([]);
    expect(rememberedUser()).toBeUndefined();
    expect(await indexedDB.databases()).toEqual([]);
});

/**
 * Проверяет индикатор синхронизации в шапке: «Синхронизировано», без сети — «Офлайн» с числом
 * неотправленных в подсказке, после возврата сети и нажатия — снова «Синхронизировано»
 */
it('app_syncIndicator_showsSyncedOfflineAndRecovers', async () => {
    const server = stubServer();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('treeitem', { name: 'Идея' });
    const header = within(screen.getByRole('banner'));
    expect(await header.findByRole('button', { name: /Синхронизировано/ })).toBeVisible();

    server.offline = true;
    await rename(user, 'Идея', 'Офлайн');
    const offline = await header.findByRole('button', { name: /Офлайн/ }, { timeout: 3000 });
    expect(offline).toHaveAccessibleDescription(/Неотправленных изменений: 1/);

    server.offline = false;
    await user.click(offline);

    expect(
        await header.findByRole('button', { name: /Синхронизировано/ }, { timeout: 3000 }),
    ).toBeVisible();
    expect(server.posted).toHaveLength(1);
});

/**
 * Проверяет, что отмена предупреждения оставляет пользователя в приложении
 */
it('app_logoutWarningCancelled_staysInApplication', async () => {
    const server = stubServer();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('treeitem', { name: 'Идея' });
    server.offline = true;
    await rename(user, 'Идея', 'Офлайн');

    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Отмена' }),
    );

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Офлайн' })).toBeInTheDocument();
});

/**
 * Проверяет, что истёкший в офлайне вход не выбрасывает из приложения: работа идёт локально;
 * когда сервер подтвердит, что вход истёк, — экран входа, а после входа тем же пользователем
 * сохранённая очередь отправляется
 */
it('app_loginExpiredOffline_worksLocallyThenSendsQueueAfterLoginOfSameUser', async () => {
    const server = stubServer();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('treeitem', { name: 'Идея' });
    await waitForCachedSnapshot();

    // Токен истёк, а обновить его нельзя: сети нет
    server.changesets = 401;
    server.refresh = 'network';
    await rename(user, 'Идея', 'Локально');
    await waitFor(() =>
        expect(
            vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/auth/refresh').length,
        ).toBeGreaterThan(1),
    );
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Локально' })).toBeInTheDocument();

    // Сеть вернулась, сервер подтвердил: вход истёк (повтор отправки — через секунду)
    server.refresh = 'expired';
    expect(await screen.findByLabelText('Пароль', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(server.posted).toEqual([]);

    server.refresh = 'ok';
    server.changesets = 'ok';
    await user.type(screen.getByLabelText('Электронная почта'), 'a@b.test');
    await user.type(screen.getByLabelText('Пароль'), 'password1');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(server.posted).toHaveLength(1), { timeout: 5000 });
    expect(JSON.stringify(server.posted[0].operations)).toContain('Локально');
    expect(await screen.findByRole('treeitem', { name: 'Локально' })).toBeInTheDocument();
}, 20_000);
