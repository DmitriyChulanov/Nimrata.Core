import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { ApiError, menuRegistry, tabRegistry, useExtensions } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import { App } from './App';
import { todayIso } from './extensions/tasks/dates';
import notesManifest from './extensions/notes/manifest.json';
import tasksManifest from './extensions/tasks/manifest.json';

import type { ExtensionsValue } from '@platform';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

const types = [
    ...tasksManifest.types.map((t) => ({ ...t, extension: 'tasks', extensionVersion: 14 })),
    ...notesManifest.types.map((t) => ({ ...t, extension: 'notes', extensionVersion: 14 })),
];

/**
 * Поднимает «сервер» на подставном API: `/api/types`, `/api/objects`, `/api/changesets`,
 * `/api/extensions`; вход (`/api/auth/*`) отвечает токеном
 */
function stubServer(objects: unknown[], connected = { tasks: true, notes: true }) {
    const api = createFakeApi(types, objects, {
        extensions: [
            { id: 'tasks', name: 'Трекер задач', connected: connected.tasks },
            { id: 'notes', name: 'Трекер заметок', connected: connected.notes },
        ],
    });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.startsWith('/api/') || url.startsWith('/api/auth')) {
            return jsonResponse({ accessToken: 'tok' });
        }
        const path = url.slice('/api/'.length);
        const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
        try {
            const method = init?.method ?? 'GET';
            const result =
                method === 'POST'
                    ? await api.post(path, body)
                    : method === 'PUT'
                      ? await api.put(path, body)
                      : await api.get(path);
            return jsonResponse(result);
        } catch (error) {
            if (error instanceof ApiError) {
                return jsonResponse({ detail: error.message, code: error.code }, error.status);
            }
            throw error;
        }
    });
    vi.stubGlobal('fetch', fetchMock);
    return { api, fetchMock };
}

/**
 * Для ручной проверки переключения: вкладка-проба отдаёт наружу значение `useExtensions`
 * (интерфейс Редактора расширений — отдельный тикет)
 */
const probe: { value?: ExtensionsValue } = {};
tabRegistry.register({
    id: 'extensions-probe',
    title: 'Проба расширений',
    component: function ExtensionsProbe() {
        probe.value = useExtensions();
        return <p>Экран пробы</p>;
    },
});
menuRegistry.register({
    path: ['Вид', 'Проба расширений'],
    run: (c) => c.openTab('extensions-probe'),
});

async function openProbe() {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('menuitem', { name: 'Вид' }));
    await user.click(screen.getByRole('menuitem', { name: 'Проба расширений' }));
    await screen.findByText('Экран пробы');
}

/**
 * Проверяет, что первый вход без корней создаёт стартовую структуру каждого расширения своим набором изменений
 */
it('extensions_firstLoginWithoutRoots_createsEachExtensionStartStructureInItsOwnChangeset', async () => {
    const { api } = stubServer([]);
    render(<App />);

    expect(await screen.findByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Задачи/ })).toBeInTheDocument();
    expect(api.changesets).toHaveLength(2);
});

/**
 * Проверяет, что вход при готовых корнях не создаёт дублей и не отправляет наборов
 */
it('extensions_loginWithExistingRoots_createsNoDuplicatesAndSendsNoChangesets', async () => {
    const { api } = stubServer([
        { id: 't', type: 'TasksRoot', parent: null, number: 0, properties: {} },
        { id: 'n', type: 'NotesRoot', parent: null, number: 1, properties: {} },
        { id: 'na', type: 'ActiveNotesRoot', parent: 'n', number: 0, properties: {} },
        { id: 'nc', type: 'CompletedNotesRoot', parent: 'n', number: 1, properties: {} },
        { id: 's', type: 'SettingsRoot', parent: null, number: 2, properties: {} },
        { id: 'ts', type: 'TasksSettings', parent: 's', number: 0, properties: {} },
        { id: 'ct', type: 'CategoryTemplates', parent: 'ts', number: 0, properties: {} },
    ]);
    render(<App />);

    expect(await screen.findByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
    expect(screen.getAllByRole('treeitem', { name: /Заметки/ })).toHaveLength(1);
    expect(api.changesets).toHaveLength(0);
});

/**
 * Проверяет, что отказ сервера на стартовой структуре показывается, а второе расширение всё равно запускается
 */
it('extensions_serverRejectsStartStructure_showsErrorAndOtherExtensionStillStarts', async () => {
    const { api } = stubServer([]);
    api.rejectNext(422, 'тип "CurrentTasksRoot" нельзя разместить внутри типа "TasksRoot".');
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('нельзя разместить');
    expect(await screen.findByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
});

/**
 * Проверяет, что отказ сервера при достройке повторов показывается пользователю
 */
it('extensions_serverRejectsRepeatsTopUp_showsErrorToUser', async () => {
    const today = todayIso();
    const month = `${today.slice(0, 8)}01`;
    const { api } = stubServer([
        { id: 't', type: 'TasksRoot', parent: null, number: 0, properties: {} },
        { id: 'c', type: 'CurrentTasksRoot', parent: 't', number: 0, properties: {} },
        { id: 'x', type: 'CompletedTasksRoot', parent: 't', number: 1, properties: {} },
        { id: 'n', type: 'NotesRoot', parent: null, number: 1, properties: {} },
        { id: 'm', type: 'Month', parent: 'c', number: 0, properties: { date: month } },
        { id: 'd', type: 'Day', parent: 'm', number: 0, properties: { date: today } },
        {
            id: 'k',
            type: 'Task',
            parent: 'd',
            number: 0,
            properties: { title: 'Ежедневно', repeat: 'weekly', repeatId: 'r1' },
        },
    ]);
    api.rejectNext(422, 'сервер недоступен для достройки');
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('сервер недоступен для достройки');
});

/**
 * Проверяет, что при отключённом «Трекере задач» его корней нет, уведомления не работают, а подключение достраивает всё
 */
it('extensions_tasksDisconnected_noRootsNoNotificationsAndConnectingStartsThem', async () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
    const { api } = stubServer([], { tasks: false, notes: true });
    render(<App />);

    expect(await screen.findByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: /Задачи/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Включить уведомления' })).not.toBeInTheDocument();
    expect(api.changesets).toHaveLength(1);

    await openProbe();
    await act(async () => {
        expect(await probe.value!.setConnected('tasks', true)).toEqual({ ok: true });
    });

    expect(await screen.findByRole('treeitem', { name: /Задачи/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Включить уведомления' })).toBeInTheDocument();
    expect(api.changesets).toHaveLength(2);
});

/**
 * Проверяет, что отключение скрывает дерево расширения без перезагрузки страницы, а подключение возвращает его без дубликатов
 */
it('extensions_disconnectAndReconnect_hidesAndRestoresTreeWithoutDuplicates', async () => {
    const { api } = stubServer([]);
    render(<App />);
    expect(await screen.findByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
    await openProbe();

    await act(async () => {
        expect(await probe.value!.setConnected('notes', false)).toEqual({ ok: true });
    });
    await waitFor(() =>
        expect(screen.queryByRole('treeitem', { name: /Заметки/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('treeitem', { name: /Задачи/ })).toBeInTheDocument();
    // вкладки платформы остаются
    expect(screen.getByText('Экран пробы')).toBeInTheDocument();

    const sent = api.changesets.length;
    await act(async () => {
        expect(await probe.value!.setConnected('notes', true)).toEqual({ ok: true });
    });

    expect(await screen.findByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
    expect(screen.getAllByRole('treeitem', { name: /Заметки/ })).toHaveLength(1);
    expect(api.changesets).toHaveLength(sent);
});

/**
 * Проверяет сквозной путь: Редактор расширений отключает оба расширения, рабочая область остаётся
 * (вкладка не пересоздаётся), показывается подсказка, а подключение возвращает дерево
 */
it('extensions_editorDisconnectAll_keepsTabShowsEmptyHintAndReconnectRestoresTree', async () => {
    stubServer([]);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('treeitem', { name: /Заметки/ });
    await user.click(screen.getByRole('menuitem', { name: 'Вид' }));
    await user.click(screen.getByRole('menuitem', { name: 'Расширения' }));

    const tasks = within(await screen.findByRole('group', { name: 'Трекер задач' }));
    await user.click(tasks.getByRole('switch', { name: 'Подключено' }));
    await waitFor(() =>
        expect(screen.queryByRole('treeitem', { name: /Задачи/ })).not.toBeInTheDocument(),
    );
    const notes = within(screen.getByRole('group', { name: 'Трекер заметок' }));
    await waitFor(() => expect(notes.getByRole('switch')).toBeEnabled());
    await user.click(notes.getByRole('switch', { name: 'Подключено' }));

    expect(await screen.findByText(/Вид → Расширения/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Расширения' })).toBeInTheDocument();

    await waitFor(() => expect(notes.getByRole('switch')).toBeEnabled());
    await user.click(notes.getByRole('switch', { name: 'Подключено' }));
    expect(await screen.findByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
});
