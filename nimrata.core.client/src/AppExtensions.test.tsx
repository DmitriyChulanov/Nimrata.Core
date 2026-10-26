import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { App } from './App';
import { todayIso } from './extensions/tasks/dates';
import notesManifest from './extensions/notes/manifest.json';
import tasksManifest from './extensions/tasks/manifest.json';

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
    ...tasksManifest.types.map((t) => ({ ...t, extension: 'tasks', extensionVersion: 12 })),
    ...notesManifest.types.map((t) => ({ ...t, extension: 'notes', extensionVersion: 12 })),
];

function stubApi(objects: unknown[], rejectChangesets?: string) {
    const fetchMock = vi
        .fn()
        .mockImplementation((url: string) =>
            Promise.resolve(
                url === '/api/types'
                    ? jsonResponse(types)
                    : url === '/api/objects'
                      ? jsonResponse(objects)
                      : url === '/api/changesets'
                        ? rejectChangesets
                            ? jsonResponse({ message: rejectChangesets }, 422)
                            : jsonResponse({ id: 'j1' })
                        : jsonResponse({ accessToken: 'tok' }),
            ),
        );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const changesets = (fetchMock: ReturnType<typeof stubApi>) =>
    fetchMock.mock.calls.filter(([url]) => url === '/api/changesets');

/**
 * Проверяет, что первый вход без корней создаёт стартовую структуру каждого расширения своим набором изменений
 */
it('extensions_firstLoginWithoutRoots_createsEachExtensionStartStructureInItsOwnChangeset', async () => {
    const fetchMock = stubApi([]);
    render(<App />);

    expect(await screen.findByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Задачи/ })).toBeInTheDocument();
    expect(changesets(fetchMock)).toHaveLength(2);
});

/**
 * Проверяет, что вход при готовых корнях не создаёт дублей и не отправляет наборов
 */
it('extensions_loginWithExistingRoots_createsNoDuplicatesAndSendsNoChangesets', async () => {
    const fetchMock = stubApi([
        { id: 't', type: 'TasksRoot', parent: null, order: 0, properties: {} },
        { id: 'n', type: 'NotesRoot', parent: null, order: 1, properties: {} },
        { id: 's', type: 'SelectTodayMechanism', parent: null, order: 2, properties: {} },
    ]);
    render(<App />);

    expect(await screen.findByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
    expect(screen.getAllByRole('treeitem', { name: /Заметки/ })).toHaveLength(1);
    expect(changesets(fetchMock)).toHaveLength(0);
});

/**
 * Проверяет, что отказ сервера на стартовой структуре показывается пользователю
 */
it('extensions_serverRejectsStartStructure_showsErrorToUser', async () => {
    stubApi([], 'тип "CurrentTasksRoot" нельзя разместить внутри типа "TasksRoot".');
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('нельзя разместить');
});

/**
 * Проверяет, что отказ сервера при достройке повторов показывается пользователю
 */
it('extensions_serverRejectsRepeatsTopUp_showsErrorToUser', async () => {
    const today = todayIso();
    const month = `${today.slice(0, 8)}01`;
    stubApi(
        [
            { id: 't', type: 'TasksRoot', parent: null, order: 0, properties: {} },
            { id: 'c', type: 'CurrentTasksRoot', parent: 't', order: 0, properties: {} },
            { id: 'x', type: 'CompletedTasksRoot', parent: 't', order: 1, properties: {} },
            { id: 'n', type: 'NotesRoot', parent: null, order: 1, properties: {} },
            { id: 's', type: 'SelectTodayMechanism', parent: null, order: 2, properties: {} },
            { id: 'm', type: 'Month', parent: 'c', order: 0, properties: { date: month } },
            { id: 'd', type: 'Day', parent: 'm', order: 0, properties: { date: today } },
            {
                id: 'k',
                type: 'Task',
                parent: 'd',
                order: 0,
                properties: { title: 'Ежедневно', repeat: 'weekly', repeatId: 'r1' },
            },
        ],
        'сервер недоступен для достройки',
    );
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('сервер недоступен для достройки');
});
