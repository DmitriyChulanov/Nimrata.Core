import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
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

import { ensureTasksStart, registerTasks } from './tasksExtension';

import type { CommandDefinition, TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

const info = {
    id: manifest.extension,
    name: manifest.name,
    description: manifest.description,
    icon: manifest.icon,
    defaultEnabled: true,
    connected: true,
    commands: manifest.commands as CommandDefinition[],
};

async function mount(withToday: boolean) {
    const data = createDataController({ api: createFakeApi(types, []) });
    await data.load();
    const bridge = createRevealBridge();
    registerTasks(data, { reveal: bridge.reveal });
    await ensureTasksStart(data);
    const tasksRoot = data.getChildren(null).find((o) => o.type === 'TasksRoot')!;
    const current = data.getChildren(tasksRoot.id).find((o) => o.type === 'CurrentTasksRoot')!;
    await data.runAction(current.id, 'createTask', {
        title: 'Дело',
        date: withToday ? '2026-06-10' : '2026-06-09',
    });
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
 * Команда «Выделить текущий день» в интерфейсе
 */
describe('Tracker: "Select today" interface', () => {
    afterEach(() => vi.useRealTimers());

    function freezeToday() {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 5, 10, 12, 0));
    }

    /**
     * Проверяет, что команда видна на панели в блоке Трекера задач и не создаёт узлов в основном дереве
     */
    it('selectTodayUi_command_visibleInTasksBlockOfCommandsPanelButNotInMainTree', async () => {
        freezeToday();
        await mount(true);

        expect(
            within(screen.getByRole('group', { name: 'Трекер задач' })).getByRole('button', {
                name: 'Выделить текущий день',
            }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('treeitem', { name: /Выделить текущий день/ })).toBeNull();
    });

    /**
     * Проверяет, что щелчок выделяет сегодняшний день и раскрывает его родителей
     */
    it('selectTodayUi_click_selectsTodayAndExpandsParents', async () => {
        freezeToday();
        await mount(true);

        await userEvent.click(screen.getByRole('button', { name: 'Выделить текущий день' }));

        expect(await screen.findByRole('treeitem', { name: /10\.06\.2026/ })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    /**
     * Проверяет, что при отсутствии дня на сегодня показывается понятное сообщение, а дерево не меняется
     */
    it('selectTodayUi_noDayForToday_showsClearMessageAndTreeUnchanged', async () => {
        freezeToday();
        await mount(false);
        const itemsBefore = screen.getAllByRole('treeitem').length;

        await userEvent.click(screen.getByRole('button', { name: 'Выделить текущий день' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'На сегодня в «Текущих задачах» ещё нет дня.',
        );
        expect(screen.getAllByRole('treeitem')).toHaveLength(itemsBefore);
    });
});
