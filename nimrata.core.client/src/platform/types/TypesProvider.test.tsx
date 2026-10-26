import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AuthProvider } from '@platform/auth/AuthProvider';

import { TypesProvider } from './TypesProvider';
import { useTypes } from './useTypes';

import type { TypeDefinition } from './types';

const noteType: TypeDefinition = {
    id: 'Note',
    name: 'Заметка',
    extension: 'tasks',
    extensionVersion: 1,
    properties: [{ id: 'name', name: 'Название', kind: 'string' }],
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function TypesView() {
    const { status, types, getType } = useTypes();
    return (
        <div>
            <span data-testid="status">{status}</span>
            <span data-testid="count">{types.length}</span>
            <span data-testid="note">{getType('Note')?.name ?? 'нет'}</span>
        </div>
    );
}

function renderWithAuth() {
    return render(
        <AuthProvider>
            <TypesProvider>
                <TypesView />
            </TypesProvider>
        </AuthProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

/**
 * Проверяет, что после входа типы загружаются с токеном и отдаются по идентификатору
 */
it('typesProvider_afterLogin_loadsTypesWithTokenAndServesThemById', async () => {
    const fetchMock = vi
        .fn()
        .mockImplementation((url: string) =>
            Promise.resolve(
                url === '/api/types'
                    ? jsonResponse([noteType])
                    : jsonResponse({ accessToken: 'tok' }),
            ),
        );
    vi.stubGlobal('fetch', fetchMock);

    renderWithAuth();

    expect(await screen.findByText('Заметка')).toBeInTheDocument();
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    const typesCall = fetchMock.mock.calls.find(([url]) => url === '/api/types');
    expect(new Headers(typesCall![1].headers).get('Authorization')).toBe('Bearer tok');
});

/**
 * Проверяет, что без входа типы не запрашиваются
 */
it('typesProvider_withoutLogin_doesNotRequestTypes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithAuth();

    expect(await screen.findByText('idle')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/types')).toBe(false);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
});

/**
 * Проверяет, что ошибка загрузки переводит хранилище в состояние ошибки
 */
it('typesProvider_loadError_movesStoreToErrorState', async () => {
    const fetchMock = vi
        .fn()
        .mockImplementation((url: string) =>
            Promise.resolve(
                url === '/api/types'
                    ? new Response(null, { status: 500 })
                    : jsonResponse({ accessToken: 'tok' }),
            ),
        );
    vi.stubGlobal('fetch', fetchMock);

    renderWithAuth();

    expect(await screen.findByText('error')).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('0');
});
