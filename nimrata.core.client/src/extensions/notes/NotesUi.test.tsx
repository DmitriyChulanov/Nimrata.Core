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

async function expandActive() {
    await expandNotes();
    const row = screen.getByRole('treeitem', { name: /Активные/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Развернуть' }));
}

function activeRoot(data: Awaited<ReturnType<typeof setup>>['data']) {
    const notes = data.getChildren(null).find((o) => o.type === 'NotesRoot')!;
    return data.getChildren(notes.id).find((o) => o.type === 'ActiveNotesRoot')!;
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
     * Проверяет, что в корне заметок видны «Активные» и «Завершённые»
     */
    it('notesUi_notesRoot_showsActiveAndCompletedRoots', async () => {
        const { data } = await setup();
        mount(data);

        await expandNotes();

        expect(screen.getByRole('treeitem', { name: /Активные/ })).toBeInTheDocument();
        expect(screen.getByRole('treeitem', { name: /Завершённые/ })).toBeInTheDocument();
    });

    /**
     * Проверяет, что создание заметки из контекстного меню запрашивает название и добавляет заметку в дерево
     */
    it('notesUi_createNoteFromContextMenu_asksTitleAndAddsNoteToTree', async () => {
        const { data } = await setup();
        mount(data);
        await expandNotes();

        await userEvent.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: /Активные/ }),
        });
        await userEvent.click(
            within(screen.getByRole('menu', { name: 'Действия с объектом' })).getByRole(
                'menuitem',
                { name: 'Создать заметку' },
            ),
        );
        const dialog = screen.getByRole('dialog', { name: 'Создать заметку' });
        await userEvent.type(within(dialog).getByLabelText(/Имя/), 'Идея');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        await userEvent.click(
            within(screen.getByRole('treeitem', { name: /Активные/ })).getByRole('button', {
                name: 'Развернуть',
            }),
        );
        expect(await screen.findByRole('treeitem', { name: /Идея/ })).toBeInTheDocument();
    });

    /**
     * Проверяет, что кнопка внешней ссылки есть только у заметки со ссылкой и открывает её
     */
    it('notesUi_externalLinkButton_onlyOnNoteWithLinkAndOpensIt', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const { data } = await setup();
        const notes = activeRoot(data);
        const withLink = await data.create({
            type: 'Note',
            parent: notes.id,
            properties: { name: 'Со ссылкой', link: 'https://example.test/' },
        });
        const without = await data.create({
            type: 'Note',
            parent: notes.id,
            properties: { name: 'Без ссылки' },
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
     * Проверяет, что дерево показывает заметку из «Активных» по названию, без приставки статуса
     */
    it('notesUi_tree_showsActiveNoteByTitle', async () => {
        const { data } = await setup();
        await data.create({
            type: 'Note',
            parent: activeRoot(data).id,
            properties: { name: 'Идея' },
        });
        mount(data);

        await expandActive();

        expect(screen.getByRole('treeitem', { name: 'Идея' })).toBeInTheDocument();
    });

    /**
     * Проверяет, что «Завершить» в контекстном меню заметки переносит её в «Завершённые»
     */
    it('notesUi_completeFromContextMenu_movesNoteToCompleted', async () => {
        const { data } = await setup();
        await data.create({
            type: 'Note',
            parent: activeRoot(data).id,
            properties: { name: 'Идея' },
        });
        mount(data);
        await expandActive();

        await userEvent.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: 'Идея' }),
        });
        await userEvent.click(
            within(screen.getByRole('menu', { name: 'Действия с объектом' })).getByRole(
                'menuitem',
                { name: 'Завершить' },
            ),
        );

        expect(screen.queryByRole('treeitem', { name: 'Идея' })).not.toBeInTheDocument();
        await userEvent.click(
            within(screen.getByRole('treeitem', { name: /Завершённые/ })).getByRole('button', {
                name: 'Развернуть',
            }),
        );
        expect(await screen.findByRole('treeitem', { name: 'Идея' })).toBeInTheDocument();
    });
});
