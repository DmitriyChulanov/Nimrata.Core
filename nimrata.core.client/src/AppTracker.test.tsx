import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import App from './App';
import { todayIso } from './modules/tracker/dates';
import manifest from './modules/tracker/manifest.json';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

const types = manifest.types.map((t) => ({ ...t, module: 'tracker', moduleVersion: 1 }));

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

it('при первом входе без корней Трекер создаёт стартовую структуру одним набором изменений', async () => {
    const fetchMock = stubApi([]);
    render(<App />);

    expect(await screen.findByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Задачи/ })).toBeInTheDocument();
    expect(changesets(fetchMock)).toHaveLength(1);
});

it('при входе с уже созданными корнями дублей нет и наборы не отправляются', async () => {
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

it('если сервер отклонил стартовую структуру, пользователь видит ошибку', async () => {
    stubApi([], 'тип "CurrentTasksRoot" нельзя разместить внутри типа "TasksRoot".');
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('нельзя разместить');
});

it('если сервер отклонил достройку повторов, пользователь видит ошибку', async () => {
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
