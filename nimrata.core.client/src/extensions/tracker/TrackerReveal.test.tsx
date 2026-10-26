import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
    DataProvider,
    PropertyGrid,
    SelectionProvider,
    createDataController,
    useSelection,
} from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { RevealBinding } from './RevealBinding';
import { createRevealBridge } from './revealBridge';
import { ensureStartStructure, registerTracker } from './tracker';

import type { TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

function Probe({ id }: { id: string }) {
    const { selectedId, revealRequest, select } = useSelection();
    return (
        <div>
            <button type="button" onClick={() => select(id)}>
                выбрать задачу
            </button>
            <output aria-label="выделено">{selectedId}</output>
            <output aria-label="показать">{revealRequest?.id}</output>
        </div>
    );
}

/**
 * Переход по внутренней ссылке Трекера в интерфейсе
 */
describe('Tracker: internal link navigation in the interface', () => {
    /**
     * Проверяет, что кнопка выделяет целевой объект и просит дерево показать его
     */
    it('internalLinkUi_button_selectsTargetObjectAndAsksTreeToShowIt', async () => {
        const bridge = createRevealBridge();
        const data = createDataController({ api: createFakeApi(types, []) });
        await data.load();
        registerTracker(data, { reveal: bridge.reveal });
        await ensureStartStructure(data);
        const notes = data.getChildren(null).find((o) => o.type === 'NotesRoot')!;
        const tasks = data.getChildren(null).find((o) => o.type === 'TasksRoot')!;
        const current = data.getChildren(tasks.id).find((o) => o.type === 'CurrentTasksRoot')!;
        await data.runAction(current.id, 'createTask', { title: 'А', date: '2026-03-05' });
        const month = data.getChildren(current.id)[0];
        const task = data.getChildren(data.getChildren(month.id)[0].id)[0];
        await data.setProperty(task.id, 'internalLink', notes.id);

        render(
            <DataProvider controller={data}>
                <SelectionProvider>
                    <RevealBinding bridge={bridge} />
                    <Probe id={task.id} />
                    <PropertyGrid />
                </SelectionProvider>
            </DataProvider>,
        );
        await userEvent.click(screen.getByRole('button', { name: 'выбрать задачу' }));
        await userEvent.click(screen.getByRole('button', { name: 'Перейти по внутренней ссылке' }));

        expect(screen.getByLabelText('выделено')).toHaveTextContent(notes.id);
        expect(screen.getByLabelText('показать')).toHaveTextContent(notes.id);
    });
});
