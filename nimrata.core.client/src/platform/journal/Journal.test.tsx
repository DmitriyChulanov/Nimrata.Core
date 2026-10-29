import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@platform/api/apiClient';
import { createMenuRegistry, createTabRegistry } from '@platform/tabs/registries';

import { JournalView } from './JournalView';
import { registerJournal } from './registerJournal';

import type { ApiClient } from '@platform/api/apiClient';
import type { JournalEntry, JournalPage, JournalResolver } from './journal';

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

/**
 * Просмотр журнала
 */
describe('JournalView', () => {
    /**
     * Проверяет, что для выбранного объекта показываются записи: когда, кто, свойство, было и стало
     */
    it('journal_selectedObject_showsEntriesWhenWhoPropertyOldAndNew', async () => {
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

    /**
     * Проверяет, что создание, перенос и удаление описаны понятными строками
     */
    it('journal_createMoveDelete_areDescribedByClearLines', async () => {
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
                            number: 1,
                            properties: { title: 'Купить молоко' },
                        },
                    }),
                    entry({
                        id: 2,
                        operation: 'move',
                        old: { parent: null, number: 1 },
                        new: { parent: 'f1', number: 1 },
                    }),
                    entry({
                        id: 1,
                        operation: 'create',
                        new: { type: 'Task', parent: null, number: 1, properties: {} },
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

    /**
     * Проверяет, что записи одного набора показываются группой: одно действие — одна группа
     */
    it('journal_entriesOfOneChangeset_areShownAsGroupOneActionOneGroup', async () => {
        const { api } = fakeJournalApi({
            'journal?skip=0&take=50': {
                total: 3,
                items: [
                    entry({ id: 3, changesetId: 'c2', operation: 'update', property: 'title' }),
                    entry({ id: 2, changesetId: 'c1', operation: 'update', property: 'done' }),
                    entry({ id: 1, changesetId: 'c1', operation: 'update', property: 'title' }),
                ],
            },
        });
        const user = userEvent.setup();
        render(<JournalView api={api} selectedId={null} resolver={resolver} />);

        await user.click(screen.getByLabelText('Все мои изменения'));

        await screen.findAllByText('Название');
        const groups = screen.getAllByRole('rowgroup').slice(1); // первая — шапка таблицы
        expect(groups).toHaveLength(2);
        expect(within(groups[0]).getAllByRole('row')).toHaveLength(1);
        expect(within(groups[1]).getAllByRole('row')).toHaveLength(2);
        // Время и автор показываются один раз на группу
        expect(within(groups[1]).getAllByText('me@example.test')).toHaveLength(1);
    });

    /**
     * Проверяет, что группа не разрывается при подгрузке следующей страницы
     */
    it('journal_group_isNotSplitWhenNextPageLoads', async () => {
        const first = Array.from({ length: 50 }, (_, i) =>
            entry({ id: 100 - i, changesetId: i < 49 ? `a${i}` : 'edge' }),
        );
        const { api } = fakeJournalApi({
            'journal?objectId=t1&skip=0&take=50': { total: 51, items: first },
            'journal?objectId=t1&skip=50&take=50': {
                total: 51,
                items: [entry({ id: 50, changesetId: 'edge', property: 'done' })],
            },
        });
        const user = userEvent.setup();
        render(<JournalView api={api} selectedId="t1" resolver={resolver} />);

        await user.click(await screen.findByRole('button', { name: 'Показать ещё' }));

        await waitFor(() => expect(screen.getAllByRole('rowgroup')).toHaveLength(1 + 50));
        const groups = screen.getAllByRole('rowgroup').slice(1);
        expect(within(groups[49]).getAllByRole('row')).toHaveLength(2);
    });

    /**
     * Проверяет, что без выделения предлагается выбрать объект, а сервер не вызывается
     */
    it('journal_noSelection_suggestsSelectingObjectAndDoesNotCallServer', () => {
        const { api, get } = fakeJournalApi({});

        render(<JournalView api={api} selectedId={null} resolver={resolver} />);

        expect(screen.getByText(/Выберите объект в дереве/)).toBeInTheDocument();
        expect(get).not.toHaveBeenCalled();
    });

    /**
     * Проверяет, что смена выделения запрашивает журнал нового объекта
     */
    it('journal_selectionChange_requestsJournalOfNewObject', async () => {
        const { api, get } = fakeJournalApi({
            'journal?objectId=t1&skip=0&take=50': { total: 0, items: [] },
            'journal?objectId=f1&skip=0&take=50': { total: 0, items: [] },
        });

        const { rerender } = render(<JournalView api={api} selectedId="t1" resolver={resolver} />);
        await screen.findByText('Записей нет.');
        rerender(<JournalView api={api} selectedId="f1" resolver={resolver} />);

        await waitFor(() => expect(get).toHaveBeenCalledWith('journal?objectId=f1&skip=0&take=50'));
    });

    /**
     * Проверяет, что переключатель «Все мои изменения» показывает общий список
     */
    it('journal_allMyChangesToggle_showsCommonList', async () => {
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

    /**
     * Проверяет, что «Показать ещё» подгружает следующую страницу
     */
    it('journal_showMore_loadsNextPage', async () => {
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

    /**
     * Проверяет, что сбой загрузки показывается сообщением
     */
    it('journal_loadFailure_isShownAsMessage', async () => {
        const { api } = fakeJournalApi({});

        render(<JournalView api={api} selectedId="t1" resolver={resolver} />);

        expect(await screen.findByRole('alert')).toHaveTextContent('journal?objectId=t1');
    });

    /**
     * Проверяет, что журнал только для чтения: кнопок отката и правки нет
     */
    it('journal_readOnly_hasNoRollbackOrEditButtons', async () => {
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

/**
 * Регистрация журнала
 */
describe('registerJournal', () => {
    /**
     * Проверяет, что регистрация добавляет вкладку журнала и пункт «Вид → Журнал», который её открывает
     */
    it('journal_registration_registersJournalTabAndMenuItemViewJournalThatOpensIt', () => {
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
