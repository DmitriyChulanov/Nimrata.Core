import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { DataProvider } from '@platform/data/DataProvider';
import { createFakeApi } from '@platform/data/fakeApi';
import { PropertyGrid } from '@platform/properties/PropertyGrid';
import { SelectionProvider } from '@platform/selection/SelectionProvider';
import { useSelection } from '@platform/selection/useSelection';
import { Tree } from '@platform/tree/Tree';

const types = [
    {
        id: 'Folder',
        name: 'Папка',
        extension: 't',
        extensionVersion: 1,
        allowedChildren: ['Job'],
    },
    {
        id: 'Job',
        name: 'Работа',
        extension: 't',
        extensionVersion: 1,
        properties: [
            { id: 'name', name: 'Название', kind: 'string' },
            { id: 'status', name: 'Статус', kind: 'string' },
        ],
        actions: [
            { id: 'finish', name: 'Завершить', placements: ['propertyGrid', 'contextMenu'] },
            { id: 'gridOnly', name: 'Только в таблице', placements: ['propertyGrid'] },
            { id: 'menuOnly', name: 'Только в меню', placements: ['contextMenu'] },
            {
                id: 'noHandler',
                name: 'Без обработчика',
                placements: ['propertyGrid', 'contextMenu'],
            },
            {
                id: 'defer',
                name: 'Отложить',
                placements: ['propertyGrid'],
                parameters: [
                    { id: 'days', name: 'Дней', kind: 'integer', required: true },
                    { id: 'note', name: 'Комментарий', kind: 'string' },
                    { id: 'text', name: 'Подробно', kind: 'text' },
                    { id: 'urgent', name: 'Срочно', kind: 'boolean' },
                    { id: 'on', name: 'Дата', kind: 'date' },
                    { id: 'at', name: 'Время', kind: 'time' },
                    {
                        id: 'level',
                        name: 'Уровень',
                        kind: 'enum',
                        values: [
                            { value: 'low', name: 'Низкий' },
                            { value: 'high', name: 'Высокий' },
                        ],
                    },
                    { id: 'who', name: 'Кому', kind: 'reference', targetTypes: ['Folder'] },
                ],
            },
        ],
    },
];

const objects = [
    { id: 'f', type: 'Folder', parent: null, order: 0, properties: { name: 'Входящие' } },
    { id: 'j', type: 'Job', parent: 'f', order: 0, properties: { name: 'Дело', status: 'new' } },
];

function Select({ id }: { id: string }) {
    const { select } = useSelection();
    return (
        <button type="button" onClick={() => select(id)}>
            выбрать {id}
        </button>
    );
}

async function setup() {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    const calls: Record<string, unknown>[] = [];
    data.registerAction('Job', 'finish', (ctx) => {
        ctx.tx.setProperty(ctx.object.id, 'status', 'done');
    });
    data.registerAction('Job', 'gridOnly', () => {});
    data.registerAction('Job', 'menuOnly', () => {});
    data.registerAction('Job', 'defer', (ctx) => {
        calls.push(ctx.params);
        ctx.tx.setProperty(ctx.object.id, 'status', 'deferred');
    });
    render(
        <DataProvider controller={data}>
            <SelectionProvider>
                <Select id="j" />
                <Tree />
                <PropertyGrid />
            </SelectionProvider>
        </DataProvider>,
    );
    return { api, data, calls };
}

async function openJob() {
    await userEvent.click(screen.getByRole('button', { name: 'выбрать j' }));
}

async function expandAndContextMenu() {
    await userEvent.click(screen.getByRole('button', { name: 'Развернуть' }));
    await userEvent.pointer({
        keys: '[MouseRight]',
        target: screen.getByRole('treeitem', { name: 'Дело' }),
    });
    return screen.getByRole('menu', { name: 'Действия с объектом' });
}

/**
 * Действия в таблице свойств
 */
describe('Property grid actions', () => {
    /**
     * Проверяет, что таблица свойств показывает кнопки действий с размещением «таблица свойств» и обработчиком
     */
    it('actions_propertyGrid_showsButtonsWithPropertyGridPlacementAndHandler', async () => {
        await setup();
        await openJob();

        const bar = screen.getByRole('toolbar', { name: 'Действия' });
        const labels = within(bar)
            .getAllByRole('button')
            .map((b) => b.textContent);
        expect(labels).toEqual(['Завершить', 'Только в таблице', 'Отложить']);
    });

    /**
     * Проверяет, что кнопка без параметров запускает обработчик одним набором, а таблица обновляется
     */
    it('actions_buttonWithoutParameters_runsHandlerInOneChangesetAndGridUpdates', async () => {
        const { api } = await setup();
        await openJob();

        await userEvent.click(screen.getByRole('button', { name: 'Завершить' }));

        expect(api.changesets).toHaveLength(1);
        expect(screen.getByLabelText('Статус')).toHaveValue('done');
    });

    /**
     * Проверяет, что отмена хуком показывается сообщением и ничего не меняет
     */
    it('actions_hookCancellation_isShownAsMessageAndChangesNothing', async () => {
        const { api, data } = await setup();
        data.registerHook('Job', 'setProperty', 'before', () => ({ cancel: 'Хук против.' }));
        await openJob();

        await userEvent.click(screen.getByRole('button', { name: 'Завершить' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Хук против.');
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что у объекта без действий нет панели действий
     */
    it('actions_objectWithoutActions_hasNoActionPanel', async () => {
        await setup();
        await userEvent.click(screen.getByRole('button', { name: 'Развернуть' }));
        await userEvent.click(screen.getByRole('treeitem', { name: 'Входящие' }));

        expect(screen.queryByRole('toolbar', { name: 'Действия' })).not.toBeInTheDocument();
    });
});

/**
 * Действия в контекстном меню дерева
 */
describe('Tree context menu actions', () => {
    /**
     * Проверяет, что контекстное меню показывает пункты с размещением «контекстное меню» и обработчиком рядом с удалением
     */
    it('actions_contextMenu_showsItemsWithContextMenuPlacementAndHandlerNextToDelete', async () => {
        await setup();
        const menu = await expandAndContextMenu();

        const items = within(menu)
            .getAllByRole('menuitem')
            .map((i) => i.textContent);
        expect(items).toContain('Завершить');
        expect(items).toContain('Только в меню');
        expect(items).toContain('Удалить');
        expect(items).not.toContain('Только в таблице');
        expect(items).not.toContain('Без обработчика');
    });

    /**
     * Проверяет, что щелчок по пункту запускает действие над объектом узла
     */
    it('actions_contextMenuClick_runsActionOnNodeObject', async () => {
        const { api, data } = await setup();
        const menu = await expandAndContextMenu();

        await userEvent.click(within(menu).getByRole('menuitem', { name: 'Завершить' }));

        expect(api.changesets).toHaveLength(1);
        expect(data.getObject('j')?.properties.status).toBe('done');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    /**
     * Проверяет, что отказ действия из контекстного меню показывается сообщением
     */
    it('actions_contextMenuFailure_isShownAsMessage', async () => {
        const { data } = await setup();
        data.registerHook('Job', 'setProperty', 'before', () => ({ cancel: 'Нельзя.' }));
        const menu = await expandAndContextMenu();

        await userEvent.click(within(menu).getByRole('menuitem', { name: 'Завершить' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Нельзя.');
    });
});

/**
 * Диалог параметров действия
 */
describe('Action parameters dialog', () => {
    async function openDefer() {
        const ctx = await setup();
        await openJob();
        await userEvent.click(screen.getByRole('button', { name: 'Отложить' }));
        return { ...ctx, dialog: screen.getByRole('dialog', { name: 'Отложить' }) };
    }

    /**
     * Проверяет, что диалог строит поля для всех восьми видов параметров
     */
    it('actionDialog_builds_fieldsForAllEightParameterKinds', async () => {
        const { dialog } = await openDefer();

        expect(within(dialog).getByLabelText(/Дней/)).toHaveAttribute('inputmode', 'numeric');
        expect(within(dialog).getByLabelText('Комментарий')).toHaveAttribute('type', 'text');
        expect(within(dialog).getByLabelText('Подробно').tagName).toBe('TEXTAREA');
        expect(within(dialog).getByLabelText('Срочно')).toHaveAttribute('type', 'checkbox');
        expect(within(dialog).getByLabelText('Дата')).toHaveAttribute('type', 'date');
        expect(within(dialog).getByLabelText('Время')).toHaveAttribute('type', 'time');
        const level = within(dialog).getByLabelText('Уровень');
        expect(
            within(level)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['', 'Низкий', 'Высокий']);
        const who = within(dialog).getByLabelText('Кому');
        expect(
            within(who)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['', 'Входящие']);
    });

    /**
     * Проверяет, что пропущенный обязательный параметр блокирует отправку и показывает причину
     */
    it('actionDialog_missingRequiredParameter_blocksSubmitAndShowsReason', async () => {
        const { api, calls, dialog } = await openDefer();

        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        expect(within(dialog).getByRole('alert')).toHaveTextContent('Параметр «Дней» обязателен.');
        expect(calls).toEqual([]);
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что отправка передаёт собранные параметры обработчику, пустые опускает и закрывает диалог
     */
    it('actionDialog_submit_passesCollectedParametersToHandlerAndClosesEmptyOnesOmitted', async () => {
        const { api, calls, dialog } = await openDefer();

        await userEvent.type(within(dialog).getByLabelText(/Дней/), '3');
        await userEvent.type(within(dialog).getByLabelText('Комментарий'), 'позже');
        await userEvent.click(within(dialog).getByLabelText('Срочно'));
        await userEvent.selectOptions(within(dialog).getByLabelText('Уровень'), 'high');
        await userEvent.selectOptions(within(dialog).getByLabelText('Кому'), 'f');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        expect(calls).toEqual([{ days: 3, note: 'позже', urgent: true, level: 'high', who: 'f' }]);
        expect(api.changesets).toHaveLength(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    /**
     * Проверяет, что формат числа проверяется
     */
    it('actionDialog_number_formatIsValidated', async () => {
        const { calls, dialog } = await openDefer();

        await userEvent.type(within(dialog).getByLabelText(/Дней/), 'abc');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        expect(within(dialog).getByRole('alert')).toHaveTextContent('Дней');
        expect(calls).toEqual([]);
    });

    /**
     * Проверяет, что отмена закрывает диалог без запуска
     */
    it('actionDialog_cancel_closesWithoutRunning', async () => {
        const { api, calls, dialog } = await openDefer();

        await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(calls).toEqual([]);
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что отказ хука при запуске показывается в диалоге, а диалог остаётся открытым
     */
    it('actionDialog_hookRejectionOnRun_isShownInDialogAndDialogStaysOpen', async () => {
        const { data, dialog } = await openDefer();
        data.registerHook('Job', 'setProperty', 'before', () => ({ cancel: 'Хук против.' }));

        await userEvent.type(within(dialog).getByLabelText(/Дней/), '1');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Выполнить' }));

        expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
            'Хук против.',
        );
    });
});
