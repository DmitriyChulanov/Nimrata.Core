import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import App from './App';
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

function stubApi(objects: unknown[]) {
    const fetchMock = vi
        .fn()
        .mockImplementation((url: string) =>
            Promise.resolve(
                url === '/api/types'
                    ? jsonResponse(types)
                    : url === '/api/objects'
                      ? jsonResponse(objects)
                      : url === '/api/changesets'
                        ? jsonResponse({ id: 'j1' })
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
