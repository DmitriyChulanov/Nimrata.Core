import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
    AutomationTab,
    DataProvider,
    PropertyGrid,
    SelectionProvider,
    Tree,
    createDataController,
} from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureNotesStart, registerNotes } from './notesExtension';

import type { DataController, TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

async function setup() {
    const data = createDataController({ api: createFakeApi(types, []) });
    await data.load();
    registerNotes(data);
    await ensureNotesStart(data);
    const root = data.getChildren(null).find((o) => o.type === 'NotesRoot')!;
    await data.runAction(root.id, 'createNoteGroup', { name: 'Работа' });
    const group = data.getChildren(root.id)[0];
    await data.runAction(group.id, 'createNote', { title: 'Отчёт' });
    const note = data.getChildren(group.id)[0];
    return { data, group, note };
}

function mount(data: DataController) {
    render(
        <DataProvider controller={data}>
            <SelectionProvider>
                <Tree />
                <AutomationTab />
                <PropertyGrid />
            </SelectionProvider>
        </DataProvider>,
    );
}

/**
 * Быстрый доступ Трекера в интерфейсе
 */
describe('Tracker: quick access interface', () => {
    /**
     * Проверяет, что записи скрыты в основном дереве и сгруппированы по названию цели во вкладке автоматизации
     */
    it('quickAccessUi_entries_hiddenInMainTreeAndGroupedByTargetNameInAutomationTab', async () => {
        const { data, group, note } = await setup();
        await data.runAction(group.id, 'addToQuickAccess');
        await data.runAction(note.id, 'addToQuickAccess');
        mount(data);

        expect(screen.getByRole('group', { name: 'Работа' })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Отчёт' })).toBeInTheDocument();
        expect(screen.queryByRole('treeitem', { name: /Быстрый доступ/ })).toBeNull();
    });

    /**
     * Проверяет, что щелчок по записи выделяет цель в основном дереве и раскрывает путь к ней
     */
    it('quickAccessUi_clickOnEntry_selectsTargetInMainTreeAndExpandsPath', async () => {
        const { data, note } = await setup();
        await data.runAction(note.id, 'addToQuickAccess');
        mount(data);
        expect(screen.queryByRole('treeitem', { name: 'Отчёт' })).toBeNull();

        await userEvent.click(
            within(screen.getByRole('group', { name: 'Отчёт' })).getByRole('button', {
                name: 'Отчёт',
            }),
        );

        expect(await screen.findByRole('treeitem', { name: 'Отчёт' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(screen.getByRole('treeitem', { name: /Работа/ })).toBeInTheDocument();
    });

    /**
     * Проверяет, что действие в таблице свойств добавляет запись, а «Убрать» удаляет её
     */
    it('quickAccessUi_addFromPropertyGrid_createsEntryAndRemoveDeletesIt', async () => {
        const { data } = await setup();
        mount(data);
        await userEvent.click(
            within(screen.getByRole('treeitem', { name: /Заметки/ })).getByRole('button', {
                name: 'Развернуть',
            }),
        );
        await userEvent.click(
            within(screen.getByRole('treeitem', { name: /Работа/ })).getByRole('button', {
                name: 'Развернуть',
            }),
        );
        await userEvent.click(await screen.findByRole('treeitem', { name: 'Отчёт' }));

        await userEvent.click(screen.getByRole('button', { name: 'Добавить' }));
        expect(await screen.findByRole('group', { name: 'Отчёт' })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Убрать' }));
        expect(screen.queryByRole('group', { name: 'Отчёт' })).toBeNull();
    });
});
