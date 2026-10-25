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
import type { TypeDefinition } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { RevealBinding } from './RevealBinding';
import { createRevealBridge } from './revealBridge';
import { ensureStartStructure, registerTracker } from './tracker';

const types = manifest.types.map((t) => ({
    ...t,
    module: manifest.module,
    moduleVersion: manifest.version,
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

describe('Трекер: переход по внутренней ссылке в интерфейсе', () => {
    it('кнопка «Перейти по внутренней ссылке» выделяет целевой объект и просит дерево его показать', async () => {
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
