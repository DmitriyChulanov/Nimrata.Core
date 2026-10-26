import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    AutomationTab,
    DataProvider,
    SelectionProvider,
    Tree,
    createDataController,
} from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { RevealBinding } from './RevealBinding';
import { createRevealBridge } from './revealBridge';
import { ensureStartStructure, registerTracker } from './tracker';

import type { TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    module: manifest.module,
    moduleVersion: manifest.version,
})) as TypeDefinition[];

async function mount(withToday: boolean) {
    const data = createDataController({ api: createFakeApi(types, []) });
    await data.load();
    const bridge = createRevealBridge();
    registerTracker(data, { reveal: bridge.reveal });
    await ensureStartStructure(data);
    const tasksRoot = data.getChildren(null).find((o) => o.type === 'TasksRoot')!;
    const current = data.getChildren(tasksRoot.id).find((o) => o.type === 'CurrentTasksRoot')!;
    await data.runAction(current.id, 'createTask', {
        title: 'Дело',
        date: withToday ? '2026-06-10' : '2026-06-09',
    });
    render(
        <DataProvider controller={data}>
            <SelectionProvider>
                <RevealBinding bridge={bridge} />
                <Tree />
                <AutomationTab />
            </SelectionProvider>
        </DataProvider>,
    );
}

/**
 * Механизм «Выделить текущий день» в интерфейсе
 */
describe('Tracker: "Select today" interface', () => {
    afterEach(() => vi.useRealTimers());

    function freezeToday() {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 5, 10, 12, 0));
    }

    /**
     * Проверяет, что механизм виден во вкладке автоматизации и скрыт в основном дереве
     */
    it('selectTodayUi_mechanism_visibleInAutomationTabButNotInMainTree', async () => {
        freezeToday();
        await mount(true);

        expect(screen.getByRole('group', { name: 'Выделить текущий день' })).toBeInTheDocument();
        expect(screen.queryByRole('treeitem', { name: /Выделить текущий день/ })).toBeNull();
    });

    /**
     * Проверяет, что щелчок выделяет сегодняшний день и раскрывает его родителей
     */
    it('selectTodayUi_click_selectsTodayAndExpandsParents', async () => {
        freezeToday();
        await mount(true);

        await userEvent.click(
            within(screen.getByRole('group', { name: 'Выделить текущий день' })).getByRole(
                'button',
                { name: 'Выделить' },
            ),
        );

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

        await userEvent.click(screen.getByRole('button', { name: 'Выделить' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'На сегодня в «Текущих задачах» ещё нет дня.',
        );
        expect(screen.getAllByRole('treeitem')).toHaveLength(itemsBefore);
    });
});
