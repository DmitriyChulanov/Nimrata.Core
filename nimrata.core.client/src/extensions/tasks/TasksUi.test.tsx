import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { ensureTasksStart, registerTasks } from './tasksExtension';

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
    registerTasks(data);
    await ensureTasksStart(data);
    return { api, data };
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

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

async function expandRow(name: RegExp | string) {
    const row = screen.getByRole('treeitem', { name });
    await userEvent.click(within(row).getByRole('button', { name: 'Развернуть' }));
}

function currentRoot(data: Awaited<ReturnType<typeof setup>>['data']) {
    const tasks = data.getChildren(null).find((o) => o.type === 'TasksRoot')!;
    return data.getChildren(tasks.id).find((o) => o.type === 'CurrentTasksRoot')!;
}

/**
 * Интерфейс Трекера задач
 */
describe('Tasks: interface', () => {
    /**
     * Проверяет, что стартовая структура видна в дереве, а заметок в нём нет
     */
    it('tasksUi_startStructure_isVisibleInTreeWithoutNotes', async () => {
        const { data } = await setup();
        mount(data);

        expect(screen.getByRole('treeitem', { name: /Задачи/ })).toBeInTheDocument();
        expect(screen.queryByRole('treeitem', { name: /Заметки/ })).not.toBeInTheDocument();
    });

    /**
     * Создаёт день `2026-03-05` в «Текущих задачах» и возвращает его и категорию «Работа»
     */
    async function seedDay(data: Awaited<ReturnType<typeof setup>>['data']) {
        await data.runAction(currentRoot(data).id, 'createTask', {
            name: 'Старая',
            date: '2026-03-05',
            category: 'Работа',
        });
        const month = data.getChildren(currentRoot(data).id)[0];
        const day = data.getChildren(month.id)[0];
        const category = data.getChildren(day.id).find((o) => o.type === 'Category')!;
        return { day, category };
    }

    /**
     * Проверяет, что «Создать задачу» из меню дня спрашивает только название и берёт дату из дня
     */
    it('tasksUi_createTaskFromDayMenu_asksOnlyTitleAndUsesDayDate', async () => {
        const { data } = await setup();
        await seedDay(data);
        mount(data);
        await expandRow(/^.*Задачи$/);
        await expandRow(/Текущие задачи/);
        await expandRow(/март, 2026/);
        await userEvent.pointer({
            keys: '[MouseRight]',
            target: screen.getByRole('treeitem', { name: /05\.03\.2026, четверг/ }),
        });
        await userEvent.click(
            within(screen.getByRole('menu', { name: 'Действия с объектом' })).getByRole(
                'menuitem',
                { name: 'Создать задачу' },
            ),
        );
        const dialog = screen.getByRole('dialog', { name: 'Создать задачу' });
        expect(within(dialog).queryByLabelText(/Дата/)).not.toBeInTheDocument();
        expect(within(dialog).queryByLabelText(/Категория/)).not.toBeInTheDocument();
        await userEvent.type(within(dialog).getByLabelText(/Имя/), 'Позвонить');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        await expandRow(/05\.03\.2026, четверг/);
        expect(await screen.findByRole('treeitem', { name: /Позвонить/ })).toBeInTheDocument();
    });

    /**
     * Проверяет, что диалог дня предлагает типовые категории и кладёт задачу в категорию по выбору
     */
    it('tasksUi_createTaskInDayWithTemplates_offersTemplateSelect', async () => {
        const { data } = await setup();
        const { day } = await seedDay(data);
        const settings = data.getChildren(null).find((o) => o.type === 'SettingsRoot')!;
        const group = data.getChildren(data.getChildren(settings.id)[0].id)[0];
        const template = await data.create({ type: 'CategoryTemplate', parent: group.id });
        if (template.ok) await data.setProperty(template.id, 'name', 'Семья');
        mount(data, day.id);
        await userEvent.click(screen.getByRole('button', { name: `выбрать ${day.id}` }));

        await userEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));
        const dialog = screen.getByRole('dialog', { name: 'Создать задачу' });
        await userEvent.type(within(dialog).getByLabelText(/Имя/), 'Ужин');
        await userEvent.click(within(dialog).getByRole('treeitem', { name: 'Семья' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        const family = data.getChildren(day.id).find((o) => o.properties.name === 'Семья')!;
        expect(data.getChildren(family.id).map((t) => t.properties.name)).toEqual(['Ужин']);
    });

    /**
     * Проверяет, что без типовых категорий выбор в диалоге дня скрыт
     */
    it('tasksUi_createTaskInDayWithoutTemplates_hidesTemplateSelect', async () => {
        const { data } = await setup();
        const { day } = await seedDay(data);
        mount(data, day.id);
        await userEvent.click(screen.getByRole('button', { name: `выбрать ${day.id}` }));

        await userEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));

        const dialog = screen.getByRole('dialog', { name: 'Создать задачу' });
        expect(within(dialog).queryByRole('tree')).not.toBeInTheDocument();
    });

    /**
     * Создаёт типовые категории «Дом» → «Подкатегория 1», «Подкатегория 2» и «Работа»
     */
    async function seedTemplates(data: Awaited<ReturnType<typeof setup>>['data']) {
        const settings = data.getChildren(null).find((o) => o.type === 'SettingsRoot')!;
        const group = data.getChildren(data.getChildren(settings.id)[0].id)[0];
        const add = async (name: string, parent: string) => {
            const created = await data.create({ type: 'CategoryTemplate', parent });
            if (!created.ok) throw new Error(created.error);
            await data.setProperty(created.id, 'name', name);
            return created.id;
        };
        const home = await add('Дом', group.id);
        const first = await add('Подкатегория 1', home);
        const second = await add('Подкатегория 2', home);
        await add('Работа', group.id);
        return { home, first, second };
    }

    /**
     * Проверяет, что диалог дня показывает иерархию шаблонов деревом и создаёт цепочку категорий
     */
    it('tasksUi_createTaskInDayWithNestedTemplates_choosesNodeInTreeAndCreatesChain', async () => {
        const { data } = await setup();
        const { day } = await seedDay(data);
        await seedTemplates(data);
        mount(data, day.id);
        await userEvent.click(screen.getByRole('button', { name: `выбрать ${day.id}` }));

        await userEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));
        const dialog = screen.getByRole('dialog', { name: 'Создать задачу' });
        expect(within(dialog).queryByRole('treeitem', { name: 'Подкатегория 1' })).toBeNull();
        await userEvent.type(within(dialog).getByLabelText(/Имя/), 'Мусор');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Развернуть' }));
        await userEvent.click(within(dialog).getByRole('treeitem', { name: 'Подкатегория 1' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        const home = data.getChildren(day.id).find((o) => o.properties.name === 'Дом')!;
        const inner = data.getChildren(home.id).find((o) => o.properties.name === 'Подкатегория 1')!;
        expect(data.getChildren(inner.id).map((t) => t.properties.name)).toEqual(['Мусор']);
    });

    /**
     * Проверяет, что последний выбор запоминается: при следующем показе дерево раскрыто до него, а
     * сброс «Без категории» кладёт задачу в день
     */
    it('tasksUi_createTaskInDay_remembersLastChoiceAndResetPutsInDay', async () => {
        const { data } = await setup();
        const { day } = await seedDay(data);
        await seedTemplates(data);
        mount(data, day.id);
        await userEvent.click(screen.getByRole('button', { name: `выбрать ${day.id}` }));
        await userEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));
        let dialog = screen.getByRole('dialog', { name: 'Создать задачу' });
        await userEvent.type(within(dialog).getByLabelText(/Имя/), 'Первая');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Развернуть' }));
        await userEvent.click(within(dialog).getByRole('treeitem', { name: 'Подкатегория 2' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        await userEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));
        dialog = screen.getByRole('dialog', { name: 'Создать задачу' });

        expect(within(dialog).getByRole('treeitem', { name: 'Подкатегория 2' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await userEvent.type(within(dialog).getByLabelText(/Имя/), 'Вторая');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Без категории' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));
        expect(data.getChildren(day.id).some((o) => o.properties.name === 'Вторая')).toBe(true);
    });

    /**
     * Проверяет, что запомненный узел, которого уже нет, молча сбрасывается
     */
    it('tasksUi_createTaskInDay_removedRememberedNode_startsCollapsedWithoutChoice', async () => {
        const { data } = await setup();
        const { day } = await seedDay(data);
        const { second } = await seedTemplates(data);
        localStorage.setItem('nimrata:lastChoice:createTask:template', second);
        await data.remove(second);
        mount(data, day.id);
        await userEvent.click(screen.getByRole('button', { name: `выбрать ${day.id}` }));

        await userEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));

        const dialog = screen.getByRole('dialog', { name: 'Создать задачу' });
        expect(within(dialog).getAllByRole('treeitem').map((i) => i.getAttribute('aria-label'))).toEqual([
            'Дом',
            'Работа',
        ]);
        expect(within(dialog).queryByRole('treeitem', { selected: true })).toBeNull();
    });

    /**
     * Проверяет, что таблица свойств дня и категории показывает действие «Создать задачу»
     */
    it('tasksUi_createTaskInPropertyGrid_isShownForDayAndCategory', async () => {
        const { data } = await setup();
        const { day, category } = await seedDay(data);
        mount(data, day.id);

        await userEvent.click(screen.getByRole('button', { name: `выбрать ${day.id}` }));
        expect(screen.getByRole('button', { name: 'Создать задачу' })).toBeInTheDocument();
        expect(data.getActions(category.id, 'propertyGrid').map((a) => a.id)).toContain(
            'createTask',
        );
    });

    /**
     * Проверяет, что у корня «Текущие задачи» и месяца нет пользовательского действия «Создать задачу»
     */
    it('tasksUi_createTask_isNotOfferedForCurrentRootAndMonth', async () => {
        const { data } = await setup();
        await seedDay(data);
        const month = data.getChildren(currentRoot(data).id)[0];

        for (const id of [currentRoot(data).id, month.id]) {
            expect(data.getActions(id, 'contextMenu')).toEqual([]);
            expect(data.getActions(id, 'propertyGrid')).toEqual([]);
        }
    });

    /**
     * Проверяет, что дни упорядочены по дате, а задачи по времени
     */
    it('tasksUi_days_orderedByDateAndTasksByTime', async () => {
        const { data } = await setup();
        const root = currentRoot(data);
        for (const date of ['2026-03-10', '2026-03-02']) {
            await data.runAction(root.id, 'createTask', { name: date, date });
        }
        const dayId = data
            .getChildren(data.getChildren(root.id)[0].id)
            .find((d) => d.properties.date === '2026-03-02')!.id;
        const late = data.getChildren(dayId)[0];
        await data.setProperty(late.id, 'time', '18:00');
        await data.runAction(dayId, 'createTask', { name: 'Утренняя' });
        const early = data.getChildren(dayId).find((o) => o.properties.name === 'Утренняя')!;
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

    /**
     * Проверяет, что таблица свойств показывает свойства задачи, но скрывает идентификатор повтора
     */
    it('tasksUi_propertyGrid_showsTaskPropertiesButHidesRepeatId', async () => {
        const { data } = await setup();
        await data.runAction(currentRoot(data).id, 'createTask', {
            name: 'Дело',
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

    /**
     * Проверяет, что задача с высоким приоритетом окрашена красным
     */
    it('tasksUi_highPriorityTask_isTintedRed', async () => {
        const { data } = await setup();
        await data.runAction(currentRoot(data).id, 'createTask', {
            name: 'Срочно',
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
