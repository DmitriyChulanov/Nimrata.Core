import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
    CUSTOM_COMMAND,
    CommandsTab,
    DataProvider,
    RevealBinding,
    SelectionProvider,
    Tree,
    createDataController,
    createRevealBridge,
} from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';
import { ExtensionsContext } from '@platform/extensionCatalog/ExtensionsContext';

import manifest from './manifest.json';
import { ensureNotesStart, registerNotes } from './notesExtension';

import type { CommandDefinition, TypeDefinition } from '@platform';

const types = [
    {
        id: CUSTOM_COMMAND,
        name: 'Пользовательская команда',
        hiddenInTree: true,
        properties: [
            { id: 'name', name: 'Имя', kind: 'string' },
            { id: 'extension', name: 'Расширение', kind: 'string' },
            { id: 'command', name: 'Команда', kind: 'string' },
            { id: 'params', name: 'Параметры', kind: 'text' },
        ],
    },
    ...manifest.types.map((t) => ({
        ...t,
        extension: manifest.extension,
        extensionVersion: manifest.version,
    })),
] as TypeDefinition[];

const info = {
    id: manifest.extension,
    name: manifest.name,
    description: manifest.description,
    icon: manifest.icon,
    defaultEnabled: true,
    connected: true,
    commands: manifest.commands as CommandDefinition[],
};

async function mount(titles: string[]) {
    const data = createDataController({ api: createFakeApi(types, []) });
    await data.load();
    const bridge = createRevealBridge();
    registerNotes(data, { reveal: bridge.reveal });
    await ensureNotesStart(data);
    const notes = data.getChildren(null).find((o) => o.type === 'NotesRoot')!;
    const active = data.getChildren(notes.id).find((o) => o.type === 'ActiveNotesRoot')!;
    for (const title of titles) {
        await data.runAction(active.id, 'createNote', { name: title });
        const note = data.getChildren(active.id).find((o) => o.properties.name === title)!;
        await data.runAction(note.id, 'createQuickAccessCommand');
    }
    render(
        <DataProvider controller={data}>
            <SelectionProvider>
                <ExtensionsContext.Provider
                    value={{
                        status: 'ready',
                        error: null,
                        extensions: [info],
                        switchingId: null,
                        setConnected: async () => ({ ok: true }),
                        reload: async () => {},
                    }}
                >
                    <RevealBinding bridge={bridge} />
                    <Tree />
                    <CommandsTab />
                </ExtensionsContext.Provider>
            </SelectionProvider>
        </DataProvider>,
    );
}

/**
 * Команды быстрого доступа на панели «Команды»
 */
describe('Notes: quick access commands panel', () => {
    /**
     * Проверяет, что команды стоят в блоке «Трекер заметок» по алфавиту, а шаблон не показан
     */
    it('quickAccessUi_panel_listsCommandsInNotesBlockSortedByNameWithoutTemplate', async () => {
        await mount(['Яблоко', 'Арбуз', 'Груша']);

        const block = screen.getByRole('group', { name: 'Трекер заметок' });
        expect(within(block).getAllByRole('button').map((b) => b.textContent)).toEqual([
            'Арбуз',
            'Груша',
            'Яблоко',
        ]);
        expect(screen.queryByRole('button', { name: 'Открыть в дереве' })).toBeNull();
    });

    /**
     * Проверяет, что щелчок по команде выделяет цель в дереве и раскрывает родителей
     */
    it('quickAccessUi_click_selectsTargetInTree', async () => {
        await mount(['Идея']);

        await userEvent.click(screen.getByRole('button', { name: 'Идея' }));

        expect(await screen.findByRole('treeitem', { name: 'Идея' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });
});
