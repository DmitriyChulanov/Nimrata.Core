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
import type { TypeDefinition } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { ensureStartStructure, registerTracker } from './tracker';

const types = manifest.types.map((t) => ({
    ...t,
    module: manifest.module,
    moduleVersion: manifest.version,
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
    registerTracker(data);
    await ensureStartStructure(data);
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

describe('Трекер: интерфейс заметок', () => {
    it('стартовая структура видна в дереве', async () => {
        const { data } = await setup();
        mount(data);

        expect(screen.getByRole('treeitem', { name: /Задачи/ })).toBeInTheDocument();
        expect(screen.getByRole('treeitem', { name: /Заметки/ })).toBeInTheDocument();
    });

    it('«Создать заметку» из контекстного меню спрашивает название и добавляет заметку в дерево', async () => {
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

    it('кнопка «Перейти по внешней ссылке» есть только у заметки со ссылкой и открывает её', async () => {
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

    it('в дереве заметка показывается вычисленным именем со статусом', async () => {
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

async function expandRow(name: RegExp | string) {
    const row = screen.getByRole('treeitem', { name });
    await userEvent.click(within(row).getByRole('button', { name: 'Развернуть' }));
}

function currentRoot(data: Awaited<ReturnType<typeof setup>>['data']) {
    const tasks = data.getChildren(null).find((o) => o.type === 'TasksRoot')!;
    return data.getChildren(tasks.id).find((o) => o.type === 'CurrentTasksRoot')!;
}

describe('Трекер: интерфейс задач', () => {
    it('«Создать задачу» из меню «Текущих задач» создаёт месяц, день и задачу', async () => {
        const { data } = await setup();
        mount(data);
        await expandRow(/^.*Задачи$/);
        await userEvent.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: /Текущие задачи/ }),
        });
        await userEvent.click(
            within(screen.getByRole('menu', { name: 'Действия с объектом' })).getByRole(
                'menuitem',
                { name: 'Создать задачу' },
            ),
        );
        const dialog = screen.getByRole('dialog', { name: 'Создать задачу' });
        await userEvent.type(within(dialog).getByLabelText(/Название/), 'Позвонить');
        await userEvent.type(within(dialog).getByLabelText(/Дата/), '2026-03-05');
        await userEvent.type(within(dialog).getByLabelText(/Категория/), 'Работа');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        await expandRow(/Текущие задачи/);
        await expandRow(/март, 2026/);
        await expandRow(/05\.03\.2026, четверг/);
        await expandRow(/Работа/);
        expect(await screen.findByRole('treeitem', { name: /Позвонить/ })).toBeInTheDocument();
    });

    it('дни идут по датам, задачи дня — по времени', async () => {
        const { data } = await setup();
        const root = currentRoot(data);
        for (const date of ['2026-03-10', '2026-03-02']) {
            await data.runAction(root.id, 'createTask', { title: date, date });
        }
        const dayId = data
            .getChildren(data.getChildren(root.id)[0].id)
            .find((d) => d.properties.date === '2026-03-02')!.id;
        const late = data.getChildren(dayId)[0];
        await data.setProperty(late.id, 'time', '18:00');
        await data.runAction(dayId, 'createTask', { title: 'Утренняя' });
        const early = data.getChildren(dayId).find((o) => o.properties.title === 'Утренняя')!;
        await data.setProperty(early.id, 'time', '09:00');
        mount(data);

        await expandRow(/^.*Задачи$/);
        await expandRow(/Текущие задачи/);
        await expandRow(/март, 2026/);
        await expandRow(/02\.03\.2026/);

        const names = screen.getAllByRole('treeitem').map((r) => r.textContent ?? '');
        const index = (text: string) => names.findIndex((n) => n.includes(text));
        expect(index('02.03.2026')).toBeLessThan(index('10.03.2026'));
        expect(index('09:00 — Утренняя')).toBeLessThan(index('18:00 — 2026-03-02'));
    });

    it('таблица свойств показывает свойства задачи, но скрывает идентификатор повтора', async () => {
        const { data } = await setup();
        await data.runAction(currentRoot(data).id, 'createTask', {
            title: 'Дело',
            date: '2026-03-05',
        });
        const month = data.getChildren(currentRoot(data).id)[0];
        const task = data.getChildren(data.getChildren(month.id)[0].id)[0];
        mount(data, task.id);

        await userEvent.click(screen.getByRole('button', { name: `выбрать ${task.id}` }));

        expect(screen.getByText('Уведомить за (мин)')).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Повтор' })).toBeInTheDocument();
        expect(screen.queryByText('Идентификатор повтора')).not.toBeInTheDocument();
    });

    it('задача с высоким приоритетом подкрашивается красным', async () => {
        const { data } = await setup();
        await data.runAction(currentRoot(data).id, 'createTask', {
            title: 'Срочно',
            date: '2026-03-05',
        });
        const month = data.getChildren(currentRoot(data).id)[0];
        const day = data.getChildren(month.id)[0];
        await data.setProperty(data.getChildren(day.id)[0].id, 'priority', 'high');
        mount(data);

        await expandRow(/^.*Задачи$/);
        await expandRow(/Текущие задачи/);
        await expandRow(/март, 2026/);
        await expandRow(/05\.03\.2026/);

        expect(screen.getByRole('treeitem', { name: /Срочно/ })).toHaveAttribute(
            'data-rule-color',
            'red',
        );
    });
});
