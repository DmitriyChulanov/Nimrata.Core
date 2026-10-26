import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DataProvider,
    PropertyGrid,
    SelectionProvider,
    Tree,
    createDataController,
    useSelection,
} from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureNotesStart, registerNotes } from './notesExtension';

import type { TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

function Select({ id }: { id: string }) {
    const { select } = useSelection();
    return (
        <button type="button" onClick={() => select(id)}>
            выбрать {id}
        </button>
    );
}

async function setup() {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    registerNotes(data);
    await ensureNotesStart(data);
    return { api, data };
}

async function expandNotes() {
    const row = screen.getByRole('treeitem', { name: /Заметки/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Развернуть' }));
}

function mount(data: Awaited<ReturnType<typeof setup>>['data'], selectId?: string) {
    render(
        <DataProvider controller={data}>
            <SelectionProvider>
                {selectId && <Select id={selectId} />}
                <Tree />
                <PropertyGrid />
            </SelectionProvider>
        </DataProvider>,
    );
}

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Интерфейс Трекера заметок
 */
describe('Notes: interface', () => {
    /**
     * Проверяет, что стартовая структура видна в дереве
     */
    it('notesUi_startStructure_isVisibleInTree', async () => {
        const { data } = await setup();
        mount(data);

        expect(screen.getByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
    });

    /**
     * Проверяет, что создание заметки из контекстного меню запрашивает название и добавляет заметку в дерево
     */
    it('notesUi_createNoteFromContextMenu_asksTitleAndAddsNoteToTree', async () => {
        const { data } = await setup();
        mount(data);

        await userEvent.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: /Заметки/ }),
        });
        await userEvent.click(
            within(screen.getByRole('menu', { name: 'Действия с объектом' })).getByRole(
                'menuitem',
                { name: 'Создать заметку' },
            ),
        );
        const dialog = screen.getByRole('dialog', { name: 'Создать заметку' });
        await userEvent.type(within(dialog).getByLabelText(/Название/), 'Идея');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        await expandNotes();
        expect(await screen.findByRole('treeitem', { name: /Идея/ })).toBeInTheDocument();
    });

    /**
     * Проверяет, что кнопка внешней ссылки есть только у заметки со ссылкой и открывает её
     */
    it('notesUi_externalLinkButton_onlyOnNoteWithLinkAndOpensIt', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const { data } = await setup();
        const notes = data.getChildren(null).find((o) => o.type === 'NotesRoot')!;
        const withLink = await data.create({
            type: 'Note',
            parent: notes.id,
            properties: { title: 'Со ссылкой', link: 'https://example.test/' },
        });
        const without = await data.create({
            type: 'Note',
            parent: notes.id,
            properties: { title: 'Без ссылки' },
        });
        const ids = { a: (withLink as { id: string }).id, b: (without as { id: string }).id };
        render(
            <DataProvider controller={data}>
                <SelectionProvider>
                    <Select id={ids.a} />
                    <Select id={ids.b} />
                    <PropertyGrid />
                </SelectionProvider>
            </DataProvider>,
        );

        await userEvent.click(screen.getByRole('button', { name: `выбрать ${ids.b}` }));
        expect(
            screen.queryByRole('button', { name: 'Перейти по внешней ссылке' }),
        ).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: `выбрать ${ids.a}` }));
        await userEvent.click(screen.getByRole('button', { name: 'Перейти по внешней ссылке' }));

        expect(open).toHaveBeenCalledWith('https://example.test/', '_blank', 'noopener,noreferrer');
    });

    /**
     * Проверяет, что дерево показывает заметку по вычисляемому имени со статусом
     */
    it('notesUi_tree_showsNoteByComputedNameWithStatus', async () => {
        const { data } = await setup();
        const notes = data.getChildren(null).find((o) => o.type === 'NotesRoot')!;
        await data.create({
            type: 'Note',
            parent: notes.id,
            properties: { title: 'Идея', status: 'completed' },
        });
        mount(data);

        await expandNotes();

        expect(screen.getByRole('treeitem', { name: '[Завершена] Идея' })).toBeInTheDocument();
    });
});
