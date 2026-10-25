import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/apiClient';
import type { ApiClient } from '../api/apiClient';
import { createMenuRegistry, createTabRegistry } from '../tabs/registries';
import { JournalView } from './JournalView';
import type { JournalEntry, JournalPage, JournalResolver } from './journal';
import { registerJournal } from './registerJournal';

const resolver: JournalResolver = {
    typeName: (id) => ({ Task: 'Задача', Folder: 'Папка' })[id] ?? id,
    propertyName: (_typeId, id) => ({ title: 'Название', done: 'Готово' })[id] ?? id,
    objectLabel: (id) => ({ f1: 'Входящие', t1: 'Купить молоко' })[id] ?? null,
    objectTypeId: (id) => (id === 't1' ? 'Task' : id === 'f1' ? 'Folder' : null),
};

function entry(extra: Partial<JournalEntry>): JournalEntry {
    return {
        id: 1,
        changesetId: 'c',
        at: '2026-03-04T10:20:30Z',
        user: 'me@example.test',
        objectId: 't1',
        operation: 'update',
        property: null,
        old: null,
        new: null,
        snapshot: null,
        ...extra,
    };
}

function fakeJournalApi(pages: Record<string, JournalPage>) {
    const get = vi.fn((path: string) => {
        const page = pages[path];
        return page ? Promise.resolve(page as never) : Promise.reject(new ApiError(404, path));
    });
    const api: ApiClient = {
        get: get as ApiClient['get'],
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    };
    return { api, get };
}

describe('JournalView', () => {
    it('показывает записи выбранного объекта: когда, кто, свойство, было и стало', async () => {
        const { api, get } = fakeJournalApi({
            'journal?objectId=t1&skip=0&take=50': {
                total: 1,
                items: [
                    entry({ operation: 'update', property: 'title', old: 'Старое', new: 'Новое' }),
                ],
            },
        });

        render(<JournalView api={api} selectedId="t1" resolver={resolver} />);

        const row = (await screen.findByText('Название')).closest('tr')!;
        expect(within(row).getByText('me@example.test')).toBeInTheDocument();
        expect(within(row).getByText('Старое')).toBeInTheDocument();
        expect(within(row).getByText('Новое')).toBeInTheDocument();
        expect(within(row).getByText(/2026/)).toBeInTheDocument();
        expect(get).toHaveBeenCalledWith('journal?objectId=t1&skip=0&take=50');
    });

    it('создание, перенос и удаление описываются понятными строками', async () => {
        const { api } = fakeJournalApi({
            'journal?objectId=t1&skip=0&take=50': {
                total: 3,
                items: [
                    entry({
                        id: 3,
                        operation: 'delete',
                        snapshot: {
                            type: 'Task',
                            parent: 'f1',
                            order: 1,
                            properties: { title: 'Купить молоко' },
                        },
                    }),
                    entry({
                        id: 2,
                        operation: 'move',
                        old: { parent: null, order: 1 },
                        new: { parent: 'f1', order: 1 },
                    }),
                    entry({
                        id: 1,
                        operation: 'create',
                        new: { type: 'Task', parent: null, order: 1, properties: {} },
                    }),
                ],
            },
        });

        render(<JournalView api={api} selectedId="t1" resolver={resolver} />);

        expect(await screen.findByText('Удалён объект «Задача»')).toBeInTheDocument();
        expect(screen.getByText('Перенесён')).toBeInTheDocument();
        expect(screen.getByText('в корне')).toBeInTheDocument();
        expect(screen.getByText('в «Входящие»')).toBeInTheDocument();
        expect(screen.getByText('Создан объект «Задача»')).toBeInTheDocument();
        const rows = screen.getAllByRole('row').slice(1);
        expect(rows[0]).toHaveTextContent('Удалён');
        expect(rows[2]).toHaveTextContent('Создан');
    });

    it('без выделения предлагает выбрать объект и не ходит на сервер', () => {
        const { api, get } = fakeJournalApi({});

        render(<JournalView api={api} selectedId={null} resolver={resolver} />);

        expect(screen.getByText(/Выберите объект в дереве/)).toBeInTheDocument();
        expect(get).not.toHaveBeenCalled();
    });

    it('следит за выделением: при смене объекта запрашивает его журнал', async () => {
        const { api, get } = fakeJournalApi({
            'journal?objectId=t1&skip=0&take=50': { total: 0, items: [] },
            'journal?objectId=f1&skip=0&take=50': { total: 0, items: [] },
        });

        const { rerender } = render(<JournalView api={api} selectedId="t1" resolver={resolver} />);
        await screen.findByText('Записей нет.');
        rerender(<JournalView api={api} selectedId="f1" resolver={resolver} />);

        await waitFor(() => expect(get).toHaveBeenCalledWith('journal?objectId=f1&skip=0&take=50'));
    });

    it('переключатель «все мои изменения» показывает общий список', async () => {
        const { api, get } = fakeJournalApi({
            'journal?objectId=t1&skip=0&take=50': { total: 0, items: [] },
            'journal?skip=0&take=50': {
                total: 1,
                items: [entry({ operation: 'update', property: 'done', old: false, new: true })],
            },
        });
        render(<JournalView api={api} selectedId="t1" resolver={resolver} />);
        await screen.findByText('Записей нет.');

        await userEvent.click(screen.getByRole('checkbox', { name: 'Все мои изменения' }));

        expect(await screen.findByText('Готово')).toBeInTheDocument();
        expect(get).toHaveBeenCalledWith('journal?skip=0&take=50');
        expect(screen.getByText('Купить молоко')).toBeInTheDocument();
    });

    it('«Показать ещё» подгружает следующую страницу', async () => {
        const first = Array.from({ length: 50 }, (_, i) =>
            entry({
                id: 100 - i,
                operation: 'update',
                property: 'title',
                old: `a${i}`,
                new: `b${i}`,
            }),
        );
        const { api, get } = fakeJournalApi({
            'journal?objectId=t1&skip=0&take=50': { total: 51, items: first },
            'journal?objectId=t1&skip=50&take=50': {
                total: 51,
                items: [
                    entry({
                        id: 1,
                        operation: 'update',
                        property: 'title',
                        old: 'последнее',
                        new: 'z',
                    }),
                ],
            },
        });
        render(<JournalView api={api} selectedId="t1" resolver={resolver} />);

        await userEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }));

        expect(await screen.findByText('последнее')).toBeInTheDocument();
        expect(get).toHaveBeenCalledWith('journal?objectId=t1&skip=50&take=50');
        expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument();
    });

    it('ошибка загрузки показывается сообщением', async () => {
        const { api } = fakeJournalApi({});

        render(<JournalView api={api} selectedId="t1" resolver={resolver} />);

        expect(await screen.findByRole('alert')).toHaveTextContent('journal?objectId=t1');
    });

    it('только просмотр: кнопок отката и правки нет', async () => {
        const { api } = fakeJournalApi({
            'journal?objectId=t1&skip=0&take=50': {
                total: 1,
                items: [entry({ operation: 'update', property: 'title', old: 'a', new: 'b' })],
            },
        });

        render(<JournalView api={api} selectedId="t1" resolver={resolver} />);
        await screen.findByText('Название');

        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    });
});

describe('registerJournal', () => {
    it('регистрирует вкладку «Журнал» и пункт «Вид → Журнал», открывающий её', () => {
        const tabs = createTabRegistry();
        const menu = createMenuRegistry();
        registerJournal(tabs, menu);

        expect(tabs.get('journal')?.title).toBe('Журнал');
        const item = menu.listFor('member').find((i) => i.path.join('/') === 'Вид/Журнал');
        const openTab = vi.fn();
        item!.run({ openTab });
        expect(openTab).toHaveBeenCalledWith('journal');
    });
});
