import {
    act,
    createEvent,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { DataProvider } from '@platform/data/DataProvider';
import { createFakeApi } from '@platform/data/fakeApi';
import { ExtensionsContext } from '@platform/extensionCatalog/ExtensionsContext';
import { SelectionProvider } from '@platform/selection/SelectionProvider';
import { MainMenu } from '@platform/tabs/MainMenu';
import { TabContainer } from '@platform/tabs/TabContainer';
import { TabsProvider } from '@platform/tabs/TabsProvider';
import { createMenuRegistry, createTabRegistry } from '@platform/tabs/registries';
import { Tree } from '@platform/tree/Tree';

import { CommandsTab } from './CommandsTab';
import { CUSTOM_COMMAND, createCustomCommand } from './customCommand';
import { registerCommands } from './registerCommands';

import type { ExtensionInfo } from '@platform/extensionCatalog/catalog';
import type { ExtensionsValue } from '@platform/extensionCatalog/ExtensionsContext';
import type { CommandDefinition } from '@platform/types/types';

const types = [
    {
        id: CUSTOM_COMMAND,
        name: 'Пользовательская команда',
        hiddenInTree: true,
        properties: [
            { id: 'name', name: 'Название', kind: 'string' },
            { id: 'extension', name: 'Расширение', kind: 'string' },
            { id: 'command', name: 'Команда', kind: 'string' },
            { id: 'params', name: 'Параметры', kind: 'text' },
        ],
    },
    {
        id: 'Plain',
        name: 'Обычный',
        extension: 'alpha',
        extensionVersion: 1,
        properties: [{ id: 'name', name: 'Название', kind: 'string' }],
    },
];

const run: CommandDefinition = {
    id: 'run',
    name: 'Запустить',
    icon: 'play',
    description: 'Подсказка',
};
const ask: CommandDefinition = {
    id: 'ask',
    name: 'Спросить',
    icon: 'play',
    parameters: [{ id: 'days', name: 'Дней', kind: 'integer', required: true }],
};
const fail: CommandDefinition = { id: 'fail', name: 'Сломаться', icon: 'play' };
const open: CommandDefinition = {
    id: 'open',
    name: 'Открыть',
    icon: 'star',
    template: true,
    parameters: [{ id: 'target', name: 'Цель', kind: 'string', required: true }],
};
const noHandler: CommandDefinition = { id: 'noHandler', name: 'Без обработчика', icon: 'play' };

const extension = (
    id: string,
    name: string,
    commands: CommandDefinition[],
    connected = true,
): ExtensionInfo => ({
    id,
    name,
    description: '',
    icon: 'folder',
    defaultEnabled: true,
    connected,
    commands,
});

const catalog = [
    extension('alpha', 'Альфа', [run, ask, fail, open, noHandler]),
    extension('beta', 'Бета', [{ id: 'betaRun', name: 'Бета-команда', icon: 'play' }]),
    extension('gamma', 'Гамма', [{ id: 'gammaRun', name: 'Гамма-команда', icon: 'play' }], false),
];

function value(extensions: ExtensionInfo[]): ExtensionsValue {
    return {
        status: 'ready',
        error: null,
        extensions,
        switchingId: null,
        setConnected: async () => ({ ok: true }),
        reload: async () => {},
    };
}

async function load(extensions: ExtensionInfo[] = catalog, objects: unknown[] = []) {
    const data = createDataController({ api: createFakeApi(types, objects) });
    await data.load();
    const ran: unknown[] = [];
    data.registerCommand('run', () => {
        ran.push('run');
    });
    data.registerCommand('ask', ({ params }) => {
        ran.push(params);
    });
    data.registerCommand('fail', () => {
        throw new Error('Не вышло');
    });
    data.registerCommand('open', ({ params }) => {
        ran.push({ open: params });
    });
    data.registerCommand('betaRun', () => {
        ran.push('beta');
    });
    data.registerCommand('gammaRun', () => {});
    return { data, ran, extensions };
}

type Loaded = Awaited<ReturnType<typeof load>>;

function renderTab({ data, extensions }: Loaded) {
    return render(
        <DataProvider controller={data}>
            <SelectionProvider>
                <ExtensionsContext.Provider value={value(extensions)}>
                    <Tree />
                    <CommandsTab />
                </ExtensionsContext.Provider>
            </SelectionProvider>
        </DataProvider>,
    );
}

/**
 * Вкладка «Команды»
 */
describe('Commands tab', () => {
    /**
     * Проверяет, что команды стоят блоками по подключённым расширениям, а команды без обработчика,
     * шаблоны и отключённые расширения не показываются
     */
    it('commandsTab_showsBlocksPerConnectedExtensionWithoutTemplatesAndHandlerless', async () => {
        renderTab(await load());

        const alpha = screen.getByRole('group', { name: 'Альфа' });
        expect(
            within(alpha)
                .getAllByRole('button')
                .map((b) => b.textContent),
        ).toEqual(['Запустить', 'Спросить', 'Сломаться']);
        expect(
            within(screen.getByRole('group', { name: 'Бета' })).getByRole('button'),
        ).toHaveTextContent('Бета-команда');
        expect(screen.queryByRole('group', { name: 'Гамма' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Открыть' })).toBeNull();
    });

    /**
     * Проверяет, что описание команды выводится подсказкой кнопки
     */
    it('commandsTab_commandWithDescription_showsItAsButtonTitle', async () => {
        renderTab(await load());

        expect(screen.getByRole('button', { name: 'Запустить' })).toHaveAttribute(
            'title',
            'Подсказка',
        );
    });

    /**
     * Проверяет, что расширение без доступных команд скрыто, а условие доступности убирает команду
     */
    it('commandsTab_extensionWithoutAvailableCommands_isHidden', async () => {
        const loaded = await load();
        loaded.data.registerCommand('betaRun', () => {}, { available: () => false });
        renderTab(loaded);

        expect(screen.queryByRole('group', { name: 'Бета' })).toBeNull();
        expect(screen.getByRole('group', { name: 'Альфа' })).toBeInTheDocument();
    });

    /**
     * Проверяет, что без доступных команд показывается пустое состояние
     */
    it('commandsTab_noAvailableCommands_showsEmptyState', async () => {
        renderTab(await load([extension('alpha', 'Альфа', [noHandler])]));

        expect(screen.getByText('Нет доступных команд')).toBeInTheDocument();
        expect(screen.queryByRole('group')).toBeNull();
    });

    /**
     * Проверяет, что команда запускается одним щелчком
     */
    it('commandsTab_command_runsWithOneClick', async () => {
        const loaded = await load();
        renderTab(loaded);

        await userEvent.click(screen.getByRole('button', { name: 'Запустить' }));

        expect(loaded.ran).toEqual(['run']);
    });

    /**
     * Проверяет, что ошибка запуска показывается вверху панели
     */
    it('commandsTab_commandFailure_isShownAtTopOfPanel', async () => {
        const { container } = renderTab(await load());

        await userEvent.click(screen.getByRole('button', { name: 'Сломаться' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Не вышло');
        expect(container.querySelector('.commands')?.firstElementChild).toBe(alert);
    });

    /**
     * Проверяет, что команда с параметрами открывает диалог и запускается с введёнными значениями
     */
    it('commandsTab_commandWithParameters_opensDialogAndRunsWithEnteredValues', async () => {
        const loaded = await load();
        renderTab(loaded);

        await userEvent.click(screen.getByRole('button', { name: 'Спросить' }));
        await userEvent.type(screen.getByLabelText(/Дней/), '3');
        await userEvent.click(screen.getByRole('button', { name: 'Выполнить' }));

        expect(loaded.ran).toEqual([{ days: 3 }]);
    });

    /**
     * Проверяет, что диалог не запускает команду без обязательного параметра
     */
    it('commandsTab_dialogWithoutRequiredParameter_doesNotRun', async () => {
        const loaded = await load();
        renderTab(loaded);

        await userEvent.click(screen.getByRole('button', { name: 'Спросить' }));
        await userEvent.click(screen.getByRole('button', { name: 'Выполнить' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Дней');
        expect(loaded.ran).toEqual([]);
    });

    /**
     * Проверяет, что пользовательская команда стоит в блоке своего расширения после команд манифеста
     * и запускает шаблон сохранёнными параметрами без диалога
     */
    it('commandsTab_customCommand_inOwnExtensionBlockRunsTemplateWithSavedParams', async () => {
        const loaded = await load();
        await loaded.data.perform((tx) => {
            createCustomCommand(tx, {
                name: 'Открыть заметку X',
                extension: 'alpha',
                command: 'open',
                params: { target: 'x' },
            });
        });
        renderTab(loaded);

        const alpha = screen.getByRole('group', { name: 'Альфа' });
        expect(
            within(alpha)
                .getAllByRole('button')
                .map((b) => b.textContent),
        ).toEqual(['Запустить', 'Спросить', 'Сломаться', 'Открыть заметку X']);
        expect(
            within(screen.getByRole('group', { name: 'Бета' })).queryByRole('button', {
                name: 'Открыть заметку X',
            }),
        ).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'Открыть заметку X' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(loaded.ran).toEqual([{ open: { target: 'x' } }]);
    });

    /**
     * Проверяет, что пользовательская команда скрыта вместе с отключённым расширением и с утраченной
     * командой-шаблоном, а в основном дереве не показывается
     */
    it('commandsTab_customCommand_hiddenWithDisabledExtensionOrMissingTemplate', async () => {
        const loaded = await load([
            ...catalog.slice(0, 1).map((e) => ({ ...e, connected: false })),
            catalog[1],
        ]);
        await loaded.data.perform((tx) => {
            createCustomCommand(tx, { name: 'Чужая', extension: 'alpha', command: 'open' });
            createCustomCommand(tx, { name: 'Битая', extension: 'beta', command: 'gone' });
        });
        renderTab(loaded);

        expect(screen.queryByRole('button', { name: 'Чужая' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Битая' })).toBeNull();
        expect(screen.queryByRole('treeitem', { name: /Чужая/ })).toBeNull();
    });
});

const labels = (group: string) =>
    within(screen.getByRole('group', { name: group }))
        .getAllByRole('button')
        .map((b) => b.textContent);

/**
 * Тянет кнопку на кнопку; jsdom не знает DragEvent и даёт нулевую геометрию, поэтому положение
 * указателя задаётся `clientX`: отрицательное — левая половина (`before`), иначе правая (`after`)
 */
function drag(source: string, target: string, clientX: number) {
    const sourceButton = screen.getByRole('button', { name: source });
    const targetButton = screen.getByRole('button', { name: target });
    const at = (create: typeof createEvent.dragOver) => {
        const event = create(targetButton);
        Object.defineProperty(event, 'clientX', { value: clientX });
        fireEvent(targetButton, event);
    };
    fireEvent.dragStart(sourceButton);
    at(createEvent.dragOver);
    at(createEvent.drop);
    fireEvent.dragEnd(sourceButton);
}

/**
 * Перестановка кнопок перетаскиванием
 */
describe('Commands tab reordering', () => {
    /**
     * Проверяет, что первое перетаскивание превращает команды манифеста блока в пользовательские
     * с номерами и применяет перенос
     */
    it('commandsTab_firstDrag_materializesManifestCommandsAndMoves', async () => {
        const loaded = await load();
        renderTab(loaded);

        drag('Сломаться', 'Запустить', -1);

        await waitFor(() =>
            expect(labels('Альфа')).toEqual(['Сломаться', 'Запустить', 'Спросить']),
        );
        const copies = loaded.data.getChildren(null).filter((o) => o.type === CUSTOM_COMMAND);
        expect(copies.map((o) => [o.properties.command, o.number])).toEqual([
            ['fail', 1],
            ['run', 2],
            ['ask', 3],
        ]);
        expect(copies.every((o) => o.properties.name === '' && o.properties.params === '')).toBe(
            true,
        );
        expect(labels('Бета')).toEqual(['Бета-команда']);
    });

    /**
     * Проверяет, что вставка в правую половину ставит кнопку после цели
     */
    it('commandsTab_dropOnRightHalf_insertsAfterTarget', async () => {
        renderTab(await load());

        drag('Запустить', 'Спросить', 1);

        await waitFor(() =>
            expect(labels('Альфа')).toEqual(['Спросить', 'Запустить', 'Сломаться']),
        );
    });

    /**
     * Проверяет, что порядок задаёт номер, а пользовательские команды-шаблоны переставляются так же
     */
    it('commandsTab_customCommands_followNumberAndCanBeReordered', async () => {
        const loaded = await load();
        await loaded.data.perform((tx) => {
            createCustomCommand(tx, {
                name: 'Икс',
                extension: 'alpha',
                command: 'open',
                params: {},
            });
            createCustomCommand(tx, {
                name: 'Игрек',
                extension: 'alpha',
                command: 'open',
                params: {},
            });
        });
        renderTab(loaded);
        expect(labels('Альфа')).toEqual(['Запустить', 'Спросить', 'Сломаться', 'Икс', 'Игрек']);

        drag('Игрек', 'Запустить', -1);

        await waitFor(() =>
            expect(labels('Альфа')).toEqual(['Игрек', 'Запустить', 'Спросить', 'Сломаться', 'Икс']),
        );
    });

    /**
     * Проверяет, что перенос в чужой блок отклоняется и ничего не создаёт
     */
    it('commandsTab_dropIntoOtherExtensionBlock_isRejected', async () => {
        const loaded = await load();
        renderTab(loaded);

        drag('Запустить', 'Бета-команда', -1);

        expect(labels('Альфа')).toEqual(['Запустить', 'Спросить', 'Сломаться']);
        expect(labels('Бета')).toEqual(['Бета-команда']);
        expect(loaded.data.getChildren(null)).toEqual([]);
    });

    /**
     * Проверяет, что материализованная команда с параметрами по-прежнему спрашивает параметры
     */
    it('commandsTab_materializedCommandWithParameters_stillOpensDialog', async () => {
        const loaded = await load();
        renderTab(loaded);
        drag('Сломаться', 'Запустить', -1);
        await waitFor(() => expect(labels('Альфа')[0]).toBe('Сломаться'));

        await userEvent.click(screen.getByRole('button', { name: 'Спросить' }));
        await userEvent.type(screen.getByLabelText(/Дней/), '2');
        await userEvent.click(screen.getByRole('button', { name: 'Выполнить' }));

        expect(loaded.ran).toEqual([{ days: 2 }]);
    });

    /**
     * Проверяет, что перенос откатывается Undo одним шагом, включая созданные копии
     */
    it('commandsTab_reorder_isUndoneInOneStep', async () => {
        const loaded = await load();
        renderTab(loaded);
        drag('Сломаться', 'Запустить', -1);
        await waitFor(() => expect(labels('Альфа')[0]).toBe('Сломаться'));

        await act(async () => {
            await loaded.data.undo();
        });

        expect(labels('Альфа')).toEqual(['Запустить', 'Спросить', 'Сломаться']);
        expect(loaded.data.getChildren(null)).toEqual([]);
    });
});

/**
 * Регистрация вкладки «Команды»
 */
describe('Commands tab registration', () => {
    /**
     * Проверяет, что пункт меню «Вид → Команды» открывает вкладку
     */
    it('commandsRegistration_menuViewCommands_opensTab', async () => {
        const tabs = createTabRegistry();
        const menu = createMenuRegistry();
        registerCommands(tabs, menu);
        expect(tabs.get('commands')?.title).toBe('Команды');
        expect(tabs.get('automation')).toBeUndefined();

        const { data, extensions } = await load();
        render(
            <DataProvider controller={data}>
                <ExtensionsContext.Provider value={value(extensions)}>
                    <TabsProvider registry={tabs} userId="u1">
                        <MainMenu registry={menu} role="member" />
                        <TabContainer />
                    </TabsProvider>
                </ExtensionsContext.Provider>
            </DataProvider>,
        );

        await userEvent.click(screen.getByRole('menuitem', { name: 'Вид' }));
        expect(screen.queryByRole('menuitem', { name: 'Автоматизация' })).toBeNull();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Команды' }));

        expect(screen.getByRole('tab', { name: 'Команды' })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Альфа' })).toBeInTheDocument();
    });

    /**
     * Проверяет, что вкладка открыта и активна при первом запуске, а в запомненной раскладке
     * добавляется без смены активной вкладки
     */
    it('commandsRegistration_start_opensTabWithoutChangingActiveOne', async () => {
        const tabs = createTabRegistry();
        registerCommands(tabs, createMenuRegistry());
        tabs.register({ id: 'other', title: 'Другая', component: () => <p>Другая вкладка</p> });
        const { data, extensions } = await load();
        const mount = (userId: string) =>
            render(
                <DataProvider controller={data}>
                    <ExtensionsContext.Provider value={value(extensions)}>
                        <TabsProvider registry={tabs} userId={userId}>
                            <TabContainer />
                        </TabsProvider>
                    </ExtensionsContext.Provider>
                </DataProvider>,
            );

        const first = mount('fresh');
        expect(screen.getByRole('tab', { name: 'Команды', selected: true })).toBeInTheDocument();
        first.unmount();

        localStorage.setItem(
            'nimrata.layout.saved',
            JSON.stringify({
                tabs: [{ id: 'other#1', kind: 'other' }],
                activeId: 'other#1',
                widths: { left: 200, right: 200 },
            }),
        );
        mount('saved');
        expect(screen.getByRole('tab', { name: 'Другая', selected: true })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Команды', selected: false })).toBeInTheDocument();
    });
});
