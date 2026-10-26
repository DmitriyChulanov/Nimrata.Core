import { describe, expect, it } from 'vitest';

import { createDataController } from './DataController';
import { createFakeApi } from './fakeApi';

const types = [
    { id: 'Folder', name: 'Папка', extension: 't', extensionVersion: 1 },
    {
        id: 'Task',
        name: 'Задача',
        extension: 't',
        extensionVersion: 1,
        properties: [
            { id: 'title', name: 'Название', kind: 'string' },
            { id: 'status', name: 'Статус', kind: 'string' },
            { id: 'log', name: 'Лог', kind: 'string' },
        ],
    },
];

const objects = [
    { id: 'root', type: 'Folder', parent: null, order: 0, properties: {} },
    { id: 'other', type: 'Folder', parent: null, order: 1, properties: {} },
    { id: 't1', type: 'Task', parent: 'root', order: 0, properties: { title: 'A', status: 'new' } },
];

async function loaded() {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    return { api, data };
}

/**
 * Контроллер данных: хуки «до операции»
 */
describe('DataController: before-operation hooks', () => {
    /**
     * Проверяет, что отмена в хуке прерывает операцию с сообщением, не меняя модель и сервер
     */
    it('hooksBefore_cancel_operationWithMessageModelAndServerUnchanged', async () => {
        const { api, data } = await loaded();
        data.registerHook('Task', 'setProperty', 'before', (ctx) =>
            ctx.property === 'status' && ctx.newValue === 'done'
                ? { cancel: 'Сначала заполните название.' }
                : undefined,
        );
        const result = await data.setProperty('t1', 'status', 'done');
        expect(result).toEqual({ ok: false, error: 'Сначала заполните название.' });
        expect(data.getObject('t1')?.properties.status).toBe('new');
        expect(api.changesets).toEqual([]);
        // Другие свойства хук не трогает
        expect((await data.setProperty('t1', 'title', 'B')).ok).toBe(true);
    });

    /**
     * Проверяет, что хуки срабатывают при создании, переносе и удалении
     */
    it('hooksBefore_fire_forCreateMoveAndRemove', async () => {
        const { api, data } = await loaded();
        data.registerHook('Task', 'create', 'before', () => ({ cancel: 'нельзя создавать' }));
        data.registerHook('Task', 'move', 'before', (ctx) =>
            ctx.to?.parent === 'other' ? { cancel: 'нельзя в other' } : undefined,
        );
        data.registerHook('Task', 'remove', 'before', () => ({ cancel: 'нельзя удалять' }));

        expect(await data.create({ type: 'Task', parent: 'root' })).toEqual({
            ok: false,
            error: 'нельзя создавать',
        });
        expect(await data.move('t1', { parent: 'other' })).toEqual({
            ok: false,
            error: 'нельзя в other',
        });
        expect(await data.remove('t1')).toEqual({ ok: false, error: 'нельзя удалять' });
        expect(data.getObject('t1')?.parent).toBe('root');
        expect(api.changesets).toEqual([]);
    });

    /**
     * Проверяет, что хук для любого типа действует на все типы, а отписка его снимает
     */
    it('hooksBefore_wildcardType_appliesToAllTypesAndUnsubscribeRemovesHook', async () => {
        const { data } = await loaded();
        const off = data.registerHook('*', 'remove', 'before', () => ({ cancel: 'запрет' }));
        expect((await data.remove('root')).ok).toBe(false);
        off();
        expect((await data.remove('root')).ok).toBe(true);
    });

    /**
     * Проверяет, что исключение в хуке отменяет операцию с текстом ошибки
     */
    it('hooksBefore_exception_cancelsOperationWithErrorText', async () => {
        const { data } = await loaded();
        data.registerHook('Task', 'setProperty', 'before', () => {
            throw new Error('сбой хука');
        });
        expect(await data.setProperty('t1', 'title', 'X')).toEqual({
            ok: false,
            error: 'сбой хука',
        });
        expect(data.getObject('t1')?.properties.title).toBe('A');
    });
});

/**
 * Контроллер данных: хуки «после операции» и общий набор изменений
 */
describe('DataController: after-operation hooks and shared changeset', () => {
    /**
     * Проверяет, что хук «после» расширяет тот же набор: правка свойства и побочная правка — один набор
     */
    it('hooksAfter_extendSameChangeset_propertyEditPlusSideEditIsOneChangeset', async () => {
        const { api, data } = await loaded();
        data.registerHook('Task', 'setProperty', 'after', (ctx) => {
            if (ctx.property === 'status') ctx.tx.setProperty(ctx.object.id, 'log', 'изменён');
        });
        const result = await data.setProperty('t1', 'status', 'done');
        expect(result.ok).toBe(true);
        expect(data.getObject('t1')?.properties).toMatchObject({ status: 'done', log: 'изменён' });
        expect(api.changesets).toHaveLength(1);
        expect(api.changesets[0].operations).toEqual([
            { op: 'update', id: 't1', changes: { status: { old: 'new', new: 'done' } } },
            { op: 'update', id: 't1', changes: { log: { old: null, new: 'изменён' } } },
        ]);
    });

    /**
     * Проверяет, что хук после создания может создавать вложенные узлы и переносить объекты в том же наборе
     */
    it('hooksAfter_create_canCreateNestedNodesAndMoveObjectsInSameChangeset', async () => {
        const { api, data } = await loaded();
        data.registerHook('Folder', 'create', 'after', (ctx) => {
            ctx.tx.create({ type: 'Task', parent: ctx.object.id, properties: { title: 'Первая' } });
            ctx.tx.move('t1', { parent: ctx.object.id });
        });
        const result = await data.create({ type: 'Folder', parent: null });
        expect(result.ok).toBe(true);
        const folder = result.ok ? result.id : '';
        expect(api.changesets).toHaveLength(1);
        expect(api.changesets[0].operations.map((o) => o.op)).toEqual(['create', 'create', 'move']);
        expect(data.getObject('t1')?.parent).toBe(folder);
        expect(data.getChildren(folder)).toHaveLength(2);
    });

    /**
     * Проверяет, что хук «до» тоже может добавлять операции в набор
     */
    it('hooksBefore_canAddOperationsToChangesetToo', async () => {
        const { api, data } = await loaded();
        data.registerHook('Task', 'remove', 'before', (ctx) => {
            ctx.tx.setProperty('root', 'x', 'удаляется ' + ctx.object.id);
        });
        await data.remove('t1');
        expect(api.changesets).toHaveLength(1);
        expect(api.changesets[0].operations.map((o) => o.op)).toEqual(['update', 'delete']);
    });

    /**
     * Проверяет, что отказ вложенной операции откатывает весь набор, включая исходную
     */
    it('hooks_nestedOperationFailure_revertsWholeChangesetIncludingOriginal', async () => {
        const { api, data } = await loaded();
        data.registerHook('Task', 'setProperty', 'after', (ctx) => {
            ctx.tx.setProperty('missing', 'x', 1);
        });
        const result = await data.setProperty('t1', 'status', 'done');
        expect(result).toEqual({ ok: false, error: 'Объект не найден.' });
        expect(data.getObject('t1')?.properties.status).toBe('new');
        expect(api.changesets).toEqual([]);
    });

    /**
     * Проверяет, что отказ сервера откатывает исходную и вложенные правки
     */
    it('hooks_serverRejection_revertsOriginalAndNestedChanges', async () => {
        const { api, data } = await loaded();
        data.registerHook('Folder', 'create', 'after', (ctx) => {
            ctx.tx.move('t1', { parent: ctx.object.id });
        });
        api.rejectNext(400, 'отказ');
        const result = await data.create({ type: 'Folder', parent: null });
        expect(result).toEqual({ ok: false, error: 'отказ' });
        expect(data.getObject('t1')?.parent).toBe('root');
        expect(data.getChildren(null)).toHaveLength(2);
    });

    /**
     * Проверяет, что бесконечная рекурсия хуков останавливается отказом набора
     */
    it('hooks_infiniteRecursion_isStoppedByChangesetRejection', async () => {
        const { data } = await loaded();
        data.registerHook('Task', 'setProperty', 'after', (ctx) => {
            ctx.tx.setProperty(ctx.object.id, 'log', String(Math.random()));
        });
        const result = await data.setProperty('t1', 'status', 'done');
        expect(result.ok).toBe(false);
        expect(data.getObject('t1')?.properties.status).toBe('new');
    });
});

/**
 * Контроллер данных: отключение хуков
 */
describe('DataController: disabling hooks', () => {
    /**
     * Проверяет, что параметр отключает хуки «до» и «после» для операции
     */
    it('hooksOff_option_runsOperationWithoutBeforeAndAfterHooks', async () => {
        const { api, data } = await loaded();
        let calls = 0;
        data.registerHook('Task', 'setProperty', 'before', () => {
            calls++;
            return { cancel: 'запрет' };
        });
        data.registerHook('Task', 'setProperty', 'after', () => {
            calls++;
        });
        expect((await data.setProperty('t1', 'status', 'done', { hooks: false })).ok).toBe(true);
        expect(calls).toBe(0);
        expect(api.changesets).toHaveLength(1);
        expect(api.changesets[0].operations).toHaveLength(1);
    });

    /**
     * Проверяет, что параметр действует и на создание, перенос и удаление
     */
    it('hooksOff_option_alsoAppliesToCreateMoveRemove', async () => {
        const { data } = await loaded();
        data.registerHook('*', 'create', 'before', () => ({ cancel: 'запрет' }));
        data.registerHook('*', 'move', 'before', () => ({ cancel: 'запрет' }));
        data.registerHook('*', 'remove', 'before', () => ({ cancel: 'запрет' }));
        const created = await data.create({ type: 'Task', parent: 'root' }, { hooks: false });
        expect(created.ok).toBe(true);
        expect((await data.move('t1', { parent: 'other' }, { hooks: false })).ok).toBe(true);
        expect((await data.remove('t1', { hooks: false })).ok).toBe(true);
    });
});

/**
 * Контроллер данных: произвольный набор изменений через `perform`
 */
describe('DataController.perform: arbitrary changeset', () => {
    /**
     * Проверяет, что несколько операций идут одним набором, а хуки срабатывают для каждой
     */
    it('perform_severalOperations_inOneChangesetHooksFireForEach', async () => {
        const { api, data } = await loaded();
        const seen: string[] = [];
        data.registerHook('Task', 'setProperty', 'after', (ctx) => {
            seen.push(String(ctx.property));
        });
        const result = await data.perform((tx) => {
            tx.setProperty('t1', 'title', 'Z');
            tx.setProperty('t1', 'status', 'done');
        });
        expect(result.ok).toBe(true);
        expect(seen).toEqual(['title', 'status']);
        expect(api.changesets).toHaveLength(1);
        expect(api.changesets[0].operations).toHaveLength(2);
    });

    /**
     * Проверяет, что отказ одной операции отменяет набор, а пустой набор не отправляется
     */
    it('perform_oneOperationFailure_cancelsWholeChangesetEmptyChangesetIsNotSent', async () => {
        const { api, data } = await loaded();
        const failed = await data.perform((tx) => {
            tx.setProperty('t1', 'title', 'Z');
            tx.remove('nope');
        });
        expect(failed.ok).toBe(false);
        expect(data.getObject('t1')?.properties.title).toBe('A');
        expect((await data.perform(() => {})).ok).toBe(true);
        expect(api.changesets).toEqual([]);
    });

    /**
     * Проверяет, что асинхронная функция набора и исключения поддерживаются
     */
    it('perform_asyncChangesetFunctionAndExceptions_areSupported', async () => {
        const { api, data } = await loaded();
        const ok = await data.perform(async (tx) => {
            await Promise.resolve();
            tx.setProperty('t1', 'title', 'Y');
        });
        expect(ok.ok).toBe(true);
        const thrown = await data.perform(() => {
            throw new Error('упало');
        });
        expect(thrown).toEqual({ ok: false, error: 'упало' });
        expect(api.changesets).toHaveLength(1);
    });
});

/**
 * Контроллер данных: действия
 */
describe('DataController: actions', () => {
    const actionTypes = [
        ...types.slice(0, 1),
        {
            id: 'Job',
            name: 'Работа',
            extension: 't',
            extensionVersion: 1,
            properties: [{ id: 'status', name: 'Статус', kind: 'string' }],
            actions: [
                { id: 'finish', name: 'Завершить', placements: ['propertyGrid', 'contextMenu'] },
                { id: 'grid', name: 'В таблице', placements: ['propertyGrid'] },
                { id: 'menu', name: 'В меню', placements: ['contextMenu'] },
                { id: 'auto', name: 'Автомат', placements: ['automation'] },
                { id: 'internal', name: 'Внутреннее' },
                { id: 'nohandler', name: 'Без обработчика', placements: ['propertyGrid'] },
                {
                    id: 'defer',
                    name: 'Отложить',
                    placements: ['propertyGrid'],
                    parameters: [
                        { id: 'days', name: 'Дней', kind: 'integer', required: true },
                        { id: 'note', name: 'Заметка', kind: 'string' },
                        { id: 'flag', name: 'Флаг', kind: 'boolean', required: true },
                    ],
                },
            ],
        },
    ];
    const actionObjects = [{ id: 'j', type: 'Job', parent: null, order: 0, properties: {} }];

    async function withActions() {
        const api = createFakeApi(actionTypes, actionObjects);
        const data = createDataController({ api });
        await data.load();
        for (const id of ['finish', 'grid', 'menu', 'auto', 'internal', 'defer']) {
            data.registerAction('Job', id, () => {});
        }
        return { api, data };
    }

    /**
     * Проверяет, что возвращаются только действия с обработчиком и подходящим размещением
     */
    it('getActions_returnsOnlyActionsWithHandlerAndMatchingPlacement', async () => {
        const { data } = await withActions();
        expect(data.getActions('j', 'propertyGrid').map((a) => a.id)).toEqual([
            'finish',
            'grid',
            'defer',
        ]);
        expect(data.getActions('j', 'contextMenu').map((a) => a.id)).toEqual(['finish', 'menu']);
        expect(data.getActions('j', 'automation').map((a) => a.id)).toEqual(['auto']);
        expect(data.getActions('nope', 'propertyGrid')).toEqual([]);
    });

    /**
     * Проверяет, что запуск вызывает обработчик с объектом, параметрами и набором, и всё идёт одним набором изменений
     */
    it('runAction_runsHandlerWithObjectParametersAndTx_allInOneChangeset', async () => {
        const { api, data } = await withActions();
        data.registerAction('Job', 'finish', (ctx) => {
            ctx.tx.setProperty(ctx.object.id, 'status', 'done');
            ctx.tx.create({ type: 'Job', parent: ctx.object.id });
        });
        const result = await data.runAction('j', 'finish');
        expect(result.ok).toBe(true);
        expect(data.getObject('j')?.properties.status).toBe('done');
        expect(api.changesets).toHaveLength(1);
        expect(api.changesets[0].operations.map((o) => o.op)).toEqual(['update', 'create']);
    });

    /**
     * Проверяет, что обязательные параметры проверяются до вызова обработчика
     */
    it('runAction_requiredParameters_areCheckedBeforeHandlerCall', async () => {
        const { data } = await withActions();
        let called = 0;
        data.registerAction('Job', 'defer', (ctx) => {
            called++;
            ctx.tx.setProperty(ctx.object.id, 'status', `+${String(ctx.params.days)}`);
        });
        const missing = await data.runAction('j', 'defer', { note: 'x' });
        expect(missing).toEqual({ ok: false, error: 'Параметр «Дней» обязателен.' });
        expect(called).toBe(0);
        // Булево false — это заданное значение
        const ok = await data.runAction('j', 'defer', { days: 3, flag: false });
        expect(ok.ok).toBe(true);
        expect(data.getObject('j')?.properties.status).toBe('+3');
    });

    /**
     * Проверяет, что неизвестное действие, отсутствие обработчика или объекта дают отказ
     */
    it('runAction_unknownActionNoHandlerOrMissingObject_giveRejection', async () => {
        const { data } = await withActions();
        expect((await data.runAction('j', 'nohandler')).ok).toBe(false);
        expect((await data.runAction('j', 'zzz')).ok).toBe(false);
        expect((await data.runAction('nope', 'finish')).ok).toBe(false);
    });

    /**
     * Проверяет, что внутреннее действие без размещений доступно из кода, но не из списков
     */
    it('runAction_internalActionWithoutPlacements_availableFromCodeButNotInLists', async () => {
        const { data } = await withActions();
        expect((await data.runAction('j', 'internal')).ok).toBe(true);
        for (const place of ['propertyGrid', 'contextMenu', 'automation'] as const) {
            expect(data.getActions('j', place).map((a) => a.id)).not.toContain('internal');
        }
    });

    /**
     * Проверяет, что хуки срабатывают для операций действия, а отключение их выключает
     */
    it('runAction_hooks_fireForActionOperationsAndHooksOffDisablesThem', async () => {
        const { data } = await withActions();
        data.registerAction('Job', 'finish', (ctx) => {
            ctx.tx.setProperty(ctx.object.id, 'status', 'done');
        });
        data.registerHook('Job', 'setProperty', 'before', () => ({ cancel: 'запрет' }));
        expect((await data.runAction('j', 'finish')).ok).toBe(false);
        expect((await data.runAction('j', 'finish', {}, { hooks: false })).ok).toBe(true);
    });
});

/**
 * Контроллер данных: отмена, повтор и хуки
 */
describe('DataController: undo/redo and hooks', () => {
    /**
     * Проверяет, что отмена и повтор идут без хуков, и хук «до» не блокирует отмену
     */
    it('undoRedo_applyWithoutHooks_beforeHookDoesNotBlockUndo', async () => {
        const { api, data } = await loaded();
        expect((await data.setProperty('t1', 'status', 'done')).ok).toBe(true);

        let calls = 0;
        for (const phase of ['before', 'after'] as const) {
            data.registerHook('*', 'setProperty', phase, () => {
                calls++;
                return { cancel: 'запрет' };
            });
        }
        const posted = api.changesets.length;

        expect((await data.undo()).ok).toBe(true);
        expect(data.getObject('t1')?.properties.status).toBe('new');
        expect((await data.redo()).ok).toBe(true);
        expect(data.getObject('t1')?.properties.status).toBe('done');
        expect(calls).toBe(0);
        expect(api.changesets.length).toBe(posted + 2);
    });

    /**
     * Проверяет, что набор с расширениями хуков откатывается целиком одной отменой, а очередь остаётся целой
     */
    it('undo_changesetWithHookExtensions_isRevertedWhollyByOneUndoAndQueueStaysIntact', async () => {
        const { data } = await loaded();
        data.registerHook('Task', 'setProperty', 'after', (ctx) => {
            if (ctx.property === 'status') ctx.tx.setProperty(ctx.object.id, 'log', 'изменён');
        });
        expect((await data.setProperty('t1', 'status', 'done')).ok).toBe(true);
        expect(data.getObject('t1')?.properties.log).toBe('изменён');

        const [undone, next] = await Promise.all([
            data.undo(),
            data.setProperty('t1', 'title', 'Z'),
        ]);
        expect(undone.ok).toBe(true);
        expect(next.ok).toBe(true);
        const props = data.getObject('t1')?.properties;
        expect(props?.status).toBe('new');
        expect(props?.log).toBeUndefined();
        expect(props?.title).toBe('Z');
    });
});
