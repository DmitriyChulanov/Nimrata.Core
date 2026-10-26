import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { DataProvider } from '@platform/data/DataProvider';
import { createFakeApi } from '@platform/data/fakeApi';
import { SelectionProvider } from '@platform/selection/SelectionProvider';
import { MainMenu } from '@platform/tabs/MainMenu';
import { TabContainer } from '@platform/tabs/TabContainer';
import { TabsProvider } from '@platform/tabs/TabsProvider';
import { createMenuRegistry, createTabRegistry } from '@platform/tabs/registries';
import { Tree } from '@platform/tree/Tree';

import { AutomationTab } from './AutomationTab';
import { registerAutomation } from './registerAutomation';

const types = [
    {
        id: 'Importer',
        name: 'Импорт',
        extension: 't',
        extensionVersion: 1,
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
        extension: 't',
        extensionVersion: 1,
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

/**
 * Вкладка «Автоматизация»
 */
describe('Automation tab', () => {
    /**
     * Проверяет, что вкладка показывает механизмы и их действия с размещением «автоматизация»
     */
    it('automation_tab_showsMechanismsAndTheirActionsWithAutomationPlacement', async () => {
        await setup();

        const group = screen.getByRole('group', { name: 'Импорт задач' });
        const labels = within(group)
            .getAllByRole('button')
            .map((b) => b.textContent);
        expect(labels).toEqual(['Запустить', 'Сломаться', 'Спросить']);
        expect(screen.queryByRole('group', { name: 'Простой' })).toBeNull();
    });

    /**
     * Проверяет, что механизмы, скрытые в дереве, не появляются в основном дереве
     */
    it('automation_tab_doesNotShowMechanismsHiddenInTreeInMainTree', async () => {
        await setup();

        expect(screen.getByRole('treeitem', { name: 'Простой' })).toBeInTheDocument();
        expect(screen.queryByRole('treeitem', { name: 'Импорт задач' })).toBeNull();
    });

    /**
     * Проверяет, что действие запускается одним щелчком
     */
    it('automation_action_runsWithOneClick', async () => {
        const { ran } = await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Запустить' }));

        expect(ran).toEqual(['run']);
    });

    /**
     * Проверяет, что отказ действия показывается пользователю
     */
    it('automation_actionFailure_isShown', async () => {
        await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Сломаться' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Не вышло');
    });

    /**
     * Проверяет, что действие с параметрами открывает диалог и запускается с введёнными значениями
     */
    it('automation_actionWithParameters_opensDialogAndRunsWithEnteredValues', async () => {
        const { ran } = await setup();

        await userEvent.click(screen.getByRole('button', { name: 'Спросить' }));
        await userEvent.type(screen.getByLabelText(/Дней/), '3');
        await userEvent.click(screen.getByRole('button', { name: 'Выполнить' }));

        expect(ran).toEqual([{ days: 3 }]);
    });

    /**
     * Проверяет, что вкладка обновляется при создании и удалении механизма
     */
    it('automation_tab_updatesOnMechanismCreationAndDeletion', async () => {
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

    /**
     * Проверяет, что без механизмов показывается подсказка
     */
    it('automation_noMechanisms_showsHint', async () => {
        const { data } = await load([]);
        render(
            <DataProvider controller={data}>
                <AutomationTab />
            </DataProvider>,
        );

        expect(screen.getByText('Механизмов нет.')).toBeInTheDocument();
    });
});

/**
 * Регистрация вкладки «Автоматизация»
 */
describe('Automation tab registration', () => {
    /**
     * Проверяет, что пункт меню «Вид → Автоматизация» открывает вкладку
     */
    it('automationRegistration_menuViewAutomation_opensTab', async () => {
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

/**
 * Показ цели механизма во вкладке «Автоматизация» (`revealTarget`)
 */
describe('Automation tab: mechanism target reveal (revealTarget)', () => {
    const refType = (id: string, property: string, extra: object) => ({
        id,
        name: id,
        extension: 't',
        extensionVersion: 1,
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
        // Имя `target` само по себе ничего не значит: нужен признак в определении свойства
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

    /**
     * Проверяет, что название механизма с `revealTarget` выделяет цель в дереве
     */
    it('revealTarget_mechanismNameWithRevealTarget_selectsTargetInTree', async () => {
        await setupRef();

        await userEvent.click(screen.getByRole('button', { name: 'Ярлык' }));

        expect(screen.getByRole('treeitem', { name: 'Простой' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    /**
     * Проверяет, что ссылочное свойство без признака, даже с именем `target`, не становится кнопкой
     */
    it('revealTarget_referencePropertyWithoutFlag_evenNamedTarget_isNotMadeButton', async () => {
        await setupRef();

        expect(screen.queryByRole('button', { name: 'Без признака' })).toBeNull();
        expect(screen.getByRole('group', { name: 'Без признака' })).toBeInTheDocument();
    });
});
