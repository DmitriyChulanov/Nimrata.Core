import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '../data/DataController';
import { DataProvider } from '../data/DataProvider';
import { createFakeApi } from '../data/fakeApi';
import { SelectionProvider } from '../selection/SelectionProvider';
import { MainMenu } from '../tabs/MainMenu';
import { TabContainer } from '../tabs/TabContainer';
import { TabsProvider } from '../tabs/TabsProvider';
import { createMenuRegistry, createTabRegistry } from '../tabs/registries';
import { Tree } from '../tree/Tree';
import { AutomationTab } from './AutomationTab';
import { registerAutomation } from './registerAutomation';

const types = [
    {
        id: 'Importer',
        name: 'Импорт',
        module: 't',
        moduleVersion: 1,
        automation: true,
        hiddenInTree: true,
        properties: [{ id: 'name', name: 'Название', kind: 'string' }],
        actions: [
            { id: 'run', name: 'Запустить', placements: ['automation'] },
            { id: 'menuOnly', name: 'Только в меню', placements: ['contextMenu'] },
            { id: 'fail', name: 'Сломаться', placements: ['automation'] },
            {
                id: 'ask',
                name: 'Спросить',
                placements: ['automation'],
                parameters: [{ id: 'days', name: 'Дней', kind: 'integer', required: true }],
            },
        ],
    },
    {
        id: 'Plain',
        name: 'Обычный',
        module: 't',
        moduleVersion: 1,
        properties: [{ id: 'name', name: 'Название', kind: 'string' }],
    },
];

const objects = [
    { id: 'p', type: 'Plain', parent: null, order: 0, properties: { name: 'Простой' } },
    { id: 'i', type: 'Importer', parent: null, order: 1, properties: { name: 'Импорт задач' } },
];

async function load(objs: unknown[] = objects) {
    const data = createDataController({ api: createFakeApi(types, objs) });
    await data.load();
    const ran: unknown[] = [];
    data.registerAction('Importer', 'run', () => {
        ran.push('run');
    });
    data.registerAction('Importer', 'menuOnly', () => {});
    data.registerAction('Importer', 'fail', () => {
        throw new Error('Не вышло');
    });
    data.registerAction('Importer', 'ask', (ctx) => {
        ran.push(ctx.params);
    });
    return { data, ran };
}

async function setup() {
    const { data, ran } = await load();
    render(
        <DataProvider controller={data}>
            <SelectionProvider>
                <Tree />
                <AutomationTab />
            </SelectionProvider>
        </DataProvider>,
    );
    return { data, ran };
}

describe('Вкладка «Автоматизация»', () => {
    it('показывает механизмы и их действия с placement automation', async () => {
        await setup();

        const group = screen.getByRole('group', { name: 'Импорт задач' });
        const labels = within(group)
            .getAllByRole('button')
            .map((b) => b.textContent);
        expect(labels).toEqual(['Запустить', 'Сломаться', 'Спросить']);
        expect(screen.queryByRole('group', { name: 'Простой' })).toBeNull();
    });

    it('не показывает механизмы с hiddenInTree в основном дереве', async () => {
        await setup();

        expect(screen.getByRole('treeitem', { name: 'Простой' })).toBeInTheDocument();
        expect(screen.queryByRole('treeitem', { name: 'Импорт задач' })).toBeNull();
    });

    it('запускает действие одним кликом', async () => {
        const { ran } = await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Запустить' }));

        expect(ran).toEqual(['run']);
    });

    it('показывает ошибку действия', async () => {
        await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Сломаться' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Не вышло');
    });

    it('открывает диалог параметров и запускает с введёнными значениями', async () => {
        const { ran } = await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Спросить' }));
        await userEvent.type(screen.getByLabelText(/Дней/), '3');
        await userEvent.click(screen.getByRole('button', { name: 'Выполнить' }));

        expect(ran).toEqual([{ days: 3 }]);
    });

    it('обновляется при создании и удалении механизмов', async () => {
        const { data } = await setup();

        const created = await data.create({
            type: 'Importer',
            parent: null,
            properties: { name: 'Второй' },
        });
        expect(created.ok).toBe(true);
        expect(await screen.findByRole('group', { name: 'Второй' })).toBeInTheDocument();

        await data.remove('i');
        expect(screen.queryByRole('group', { name: 'Импорт задач' })).toBeNull();
    });

    it('показывает подсказку, если механизмов нет', async () => {
        const { data } = await load([]);
        render(
            <DataProvider controller={data}>
                <AutomationTab />
            </DataProvider>,
        );

        expect(screen.getByText('Механизмов нет.')).toBeInTheDocument();
    });
});

describe('Регистрация вкладки «Автоматизация»', () => {
    it('пункт «Вид → Автоматизация» открывает вкладку', async () => {
        const tabs = createTabRegistry();
        const menu = createMenuRegistry();
        registerAutomation(tabs, menu);
        expect(tabs.get('automation')?.title).toBe('Автоматизация');

        const { data } = await load();
        render(
            <DataProvider controller={data}>
                <TabsProvider registry={tabs} userId="u1">
                    <MainMenu registry={menu} role="member" />
                    <TabContainer />
                </TabsProvider>
            </DataProvider>,
        );

        await userEvent.click(screen.getByRole('menuitem', { name: 'Вид' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Автоматизация' }));

        expect(screen.getByRole('tab', { name: 'Автоматизация' })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Импорт задач' })).toBeInTheDocument();
    });
});

describe('Вкладка «Автоматизация»: показ цели механизма (revealTarget)', () => {
    const refType = (id: string, property: string, extra: object) => ({
        id,
        name: id,
        module: 't',
        moduleVersion: 1,
        automation: true,
        hiddenInTree: true,
        properties: [
            { id: 'name', name: 'Название', kind: 'string' },
            { id: property, name: 'Цель', kind: 'reference', ...extra },
        ],
        actions: [{ id: 'run', name: 'Запустить', placements: ['automation'] }],
    });
    const refTypes = [
        ...types,
        refType('Shortcut', 'goal', { revealTarget: true }),
        // Имя `target` само по себе ничего не значит: нужен признак в определении свойства.
        refType('Plain2', 'target', {}),
    ];
    const refObjects = [
        { id: 'p', type: 'Plain', parent: null, order: 0, properties: { name: 'Простой' } },
        {
            id: 's',
            type: 'Shortcut',
            parent: null,
            order: 1,
            properties: { name: 'Ярлык', goal: 'p' },
        },
        {
            id: 'q',
            type: 'Plain2',
            parent: null,
            order: 2,
            properties: { name: 'Без признака', target: 'p' },
        },
    ];

    async function setupRef() {
        const data = createDataController({ api: createFakeApi(refTypes, refObjects) });
        await data.load();
        render(
            <DataProvider controller={data}>
                <SelectionProvider>
                    <Tree />
                    <AutomationTab />
                </SelectionProvider>
            </DataProvider>,
        );
    }

    it('название механизма со свойством revealTarget выделяет цель в дереве', async () => {
        await setupRef();

        await userEvent.click(screen.getByRole('button', { name: 'Ярлык' }));

        expect(screen.getByRole('treeitem', { name: 'Простой' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    it('ссылочное свойство без признака revealTarget (даже с именем target) названия кнопкой не делает', async () => {
        await setupRef();

        expect(screen.queryByRole('button', { name: 'Без признака' })).toBeNull();
        expect(screen.getByRole('group', { name: 'Без признака' })).toBeInTheDocument();
    });
});
