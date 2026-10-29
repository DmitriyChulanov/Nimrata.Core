import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
    DataProvider,
    RevealBinding,
    PropertyGrid,
    SelectionProvider,
    createDataController,
    createRevealBridge,
    useSelection,
} from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';

import { ensureTasksStart, registerTasks } from './tasksExtension';

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
 * Переход по внутренней ссылке Трекера задач в интерфейсе
 */
describe('Tasks: internal link navigation in the interface', () => {
    /**
     * Проверяет, что кнопка выделяет целевой объект и просит дерево показать его
     */
    it('internalLinkUi_button_selectsTargetObjectAndAsksTreeToShowIt', async () => {
        const bridge = createRevealBridge();
        const data = createDataController({ api: createFakeApi(types, []) });
        await data.load();
        registerTasks(data, { reveal: bridge.reveal });
        await ensureTasksStart(data);
        const tasks = data.getChildren(null).find((o) => o.type === 'TasksRoot')!;
        const archive = data.getChildren(tasks.id).find((o) => o.type === 'CompletedTasksRoot')!;
        const current = data.getChildren(tasks.id).find((o) => o.type === 'CurrentTasksRoot')!;
        await data.runAction(current.id, 'createTask', { name: 'А', date: '2026-03-05' });
        const month = data.getChildren(current.id)[0];
        const task = data.getChildren(data.getChildren(month.id)[0].id)[0];
        await data.setProperty(task.id, 'internalLink', archive.id);

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

        expect(screen.getByLabelText('выделено')).toHaveTextContent(archive.id);
        expect(screen.getByLabelText('показать')).toHaveTextContent(archive.id);
    });
});

/**
 * Показ созданной задачи в дереве
 */
describe('Tasks: reveal of a created task', () => {
    /**
     * Проверяет, что действие «Создать задачу» просит показать в дереве именно созданную задачу
     */
    it('createTask_action_revealsCreatedTask', async () => {
        const reveal = vi.fn();
        const data = createDataController({ api: createFakeApi(types, []) });
        await data.load();
        registerTasks(data, { reveal });
        await ensureTasksStart(data);
        const tasks = data.getChildren(null).find((o) => o.type === 'TasksRoot')!;
        const current = data.getChildren(tasks.id).find((o) => o.type === 'CurrentTasksRoot')!;
        await data.runAction(current.id, 'createTask', { name: 'А', date: '2026-03-05' });
        const month = data.getChildren(current.id)[0];
        const day = data.getChildren(month.id)[0];
        reveal.mockClear();

        await data.runAction(day.id, 'createTask', { name: 'Б' });

        const created = data.getChildren(day.id).find((o) => o.properties.name === 'Б')!;
        expect(reveal).toHaveBeenCalledExactlyOnceWith(created.id);
    });
});
