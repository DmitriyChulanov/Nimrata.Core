import { describe, expect, it } from 'vitest';

import { createActionRegistry } from './actionRegistry';

import type { ActionExecutor } from './actionRegistry';
import type { DataObject } from './DataController';
import type { ObjectReader } from '@platform/objectQueries/objectQueries';
import type { TypeDefinition } from '@platform/types/types';

const types = new Map<string, TypeDefinition>([
    [
        'Item',
        {
            id: 'Item',
            name: 'Элемент',
            extension: 't',
            extensionVersion: 1,
            actions: [
                { id: 'mark', name: 'Отметить', placements: ['propertyGrid'] },
                { id: 'hidden', name: 'Без места' },
                {
                    id: 'ask',
                    name: 'Спросить',
                    placements: ['propertyGrid'],
                    parameters: [{ id: 'days', name: 'Дней', kind: 'integer', required: true }],
                },
                {
                    id: 'pick',
                    name: 'Выбрать',
                    placements: ['propertyGrid'],
                    parameters: [{ id: 'level', name: 'Уровень', kind: 'enum' }],
                },
            ],
        } as TypeDefinition,
    ],
    [
        'Other',
        {
            id: 'Other',
            name: 'Другой',
            extension: 't',
            extensionVersion: 1,
            actions: [{ id: 'mark', name: 'Отметить', placements: ['propertyGrid'] }],
        } as TypeDefinition,
    ],
]);

function obj(id: string, type: string, name?: string): DataObject {
    return { id, type, parent: null, order: 0, properties: name ? { name } : {} };
}

const objects = new Map<string, DataObject>(
    [obj('a', 'Item', 'Первый'), obj('b', 'Item', 'Второй'), obj('c', 'Other')].map((o) => [
        o.id,
        o,
    ]),
);

const reader: ObjectReader = {
    getObject: (id) => objects.get(id),
    getType: (id) => types.get(id),
};

/** Заглушка исполнителя: выполняет шаг сразу, без сервера, и сообщает, сколько раз вызвана */
function stubExecute() {
    const calls = { count: 0 };
    const execute: ActionExecutor = async (run) => {
        calls.count += 1;
        const scope = { error: null as string | null };
        try {
            await run({} as never, scope);
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        return scope.error === null ? { ok: true } : { ok: false, error: scope.error };
    };
    return { execute, calls };
}

function setup() {
    const { execute, calls } = stubExecute();
    return { registry: createActionRegistry({ reader, execute }), calls };
}

/**
 * Реестр Действий и Команд: правила без контроллера данных и подставного API
 */
describe('createActionRegistry', () => {
    /**
     * Проверяет, что одиночный запрос Действий скрывает недоступное и не показывает без обработчика
     */
    it('getActions_unavailableOrUnhandled_hidden', () => {
        const { registry } = setup();
        registry.registerAction('Item', 'mark', () => {}, { available: (o) => o.id !== 'b' });
        registry.registerAction('Item', 'hidden', () => {});

        expect(registry.getActions('a').map((a) => a.id)).toEqual(['mark', 'hidden']);
        expect(registry.getActions('a', 'propertyGrid').map((a) => a.id)).toEqual(['mark']);
        expect(registry.getActions('b')).toEqual([{ ...types.get('Item')!.actions![1] }]);
        expect(registry.getActions('zzz')).toEqual([]);
    });

    /**
     * Проверяет, что у группы недоступное Действие показано с причиной, а общих нет у разных типов
     */
    it('getGroupActions_unavailableForOne_shownWithReason', () => {
        const { registry } = setup();
        registry.registerAction('Item', 'mark', () => {}, { available: (o) => o.id !== 'b' });
        registry.registerAction('Other', 'mark', () => {});

        const group = registry.getGroupActions(['a', 'b'], 'propertyGrid');
        expect(group).toEqual([
            {
                action: expect.objectContaining({ id: 'mark' }),
                unavailable: 'Недоступно для объекта «Второй»',
            },
        ]);
        expect(registry.getGroupActions(['a', 'c'], 'propertyGrid')).toHaveLength(1);
        expect(registry.getGroupActions(['a', 'zzz'])).toEqual([]);
        expect(registry.getGroupActions([])).toEqual([]);
    });

    /**
     * Проверяет, что правило «нет общих значений» живёт в реестре: причина в списке и в плане запуска
     */
    it('groupLaunch_noCommonValues_unavailableReasonInListAndPlan', () => {
        const { registry } = setup();
        registry.registerAction('Item', 'pick', () => {}, {
            parameterValues: {
                level: (o) =>
                    o.id === 'a' ? [{ value: 'x', name: 'X' }] : [{ value: 'y', name: 'Y' }],
            },
        });
        const pick = types.get('Item')!.actions![3]!;

        expect(registry.getGroupActions(['a', 'b'], 'propertyGrid')[0]?.unavailable).toBe(
            'Нет общих значений параметров',
        );
        expect(registry.getGroupActionParameters(['a', 'b'], pick)).toBeNull();
        expect(registry.groupLaunch(['a', 'b'], pick)).toEqual({
            unavailable: '«Выбрать»: у выделенных объектов нет общих значений параметров.',
        });
        expect(registry.groupLaunch(['a'], pick)).toEqual({
            parameters: [expect.objectContaining({ id: 'level', values: [{ value: 'x', name: 'X' }] })],
        });
    });

    /**
     * Проверяет пересечение значений параметров группы
     */
    it('groupLaunch_commonValues_intersection', () => {
        const { registry } = setup();
        registry.registerAction('Item', 'pick', () => {}, {
            parameterValues: {
                level: (o) =>
                    o.id === 'a'
                        ? [
                              { value: 'x', name: 'X' },
                              { value: 'y', name: 'Y' },
                          ]
                        : [{ value: 'y', name: 'Y' }],
            },
        });
        const pick = types.get('Item')!.actions![3]!;

        const plan = registry.groupLaunch(['a', 'b'], pick);
        expect(plan).toEqual({
            parameters: [expect.objectContaining({ values: [{ value: 'y', name: 'Y' }] })],
        });
    });

    /**
     * Проверяет, что отказы запуска возвращают точные тексты и не доходят до обработчика
     */
    it('runAction_refusals_exactReasonsHandlerNotCalled', async () => {
        const { registry } = setup();
        let called = 0;
        registry.registerAction('Item', 'ask', () => void (called += 1));
        registry.registerAction('Item', 'mark', () => void (called += 1), {
            available: (o) => o.id !== 'b',
        });

        expect(await registry.runAction('zzz', 'mark')).toEqual({
            ok: false,
            error: 'Объект не найден.',
        });
        expect(await registry.runAction('b', 'mark')).toEqual({
            ok: false,
            error: 'У объекта нет действия "mark" с обработчиком.',
        });
        expect(await registry.runAction('a', 'ask', { days: '' })).toEqual({
            ok: false,
            error: 'Параметр «Дней» обязателен.',
        });
        expect(called).toBe(0);
    });

    /**
     * Проверяет, что запуск по группе идёт через одно исполнение, по порядку, с именем объекта в отказе
     */
    it('runActionOnMany_group_oneExecuteInOrderAndPrefixesFailure', async () => {
        const { registry, calls } = setup();
        const visited: string[] = [];
        registry.registerAction('Item', 'mark', (ctx) => {
            visited.push(ctx.object.id);
            if (ctx.object.id === 'b') throw new Error('не получилось');
        });

        expect(await registry.runActionOnMany(['b', 'a'], 'mark')).toEqual({
            ok: false,
            error: 'Второй: не получилось',
        });
        expect(visited).toEqual(['b']);
        expect(calls.count).toBe(1);
        visited.length = 0;
        expect((await registry.runActionOnMany(['a', 'b'], 'mark')).ok).toBe(false);
        expect(visited).toEqual(['a', 'b']);
    });

    /**
     * Проверяет, что одиночный запуск не добавляет имя объекта к тексту отказа
     */
    it('runAction_handlerThrows_reasonWithoutObjectName', async () => {
        const { registry } = setup();
        registry.registerAction('Item', 'mark', () => {
            throw new Error('сломалось');
        });

        expect(await registry.runAction('a', 'mark')).toEqual({ ok: false, error: 'сломалось' });
    });

    /**
     * Проверяет команды: недоступность, обязательные параметры, отписку без снятия более новой
     */
    it('commands_availabilityRequiredAndUnregister', async () => {
        const { registry, calls } = setup();
        const command = {
            id: 'cmd',
            name: 'Команда',
            parameters: [{ id: 'days', name: 'Дней', kind: 'integer' as const, required: true }],
        };
        expect(registry.isCommandAvailable('cmd')).toBe(false);
        expect(await registry.runCommand(command)).toEqual({
            ok: false,
            error: 'Команда "cmd" недоступна.',
        });

        let open = false;
        const off = registry.registerCommand('cmd', () => {}, { available: () => open });
        expect(registry.isCommandAvailable('cmd')).toBe(false);
        open = true;
        expect(registry.isCommandAvailable('cmd')).toBe(true);
        expect(await registry.runCommand(command, {})).toEqual({
            ok: false,
            error: 'Параметр «Дней» обязателен.',
        });
        expect(calls.count).toBe(0);
        expect((await registry.runCommand(command, { days: 3 })).ok).toBe(true);

        registry.registerCommand('cmd', () => {});
        off();
        expect(registry.isCommandAvailable('cmd')).toBe(true);
    });

    /**
     * Проверяет правило обязательных параметров
     */
    it('missingRequired_emptyValues_firstRequiredReported', () => {
        const { registry } = setup();
        const defs = [
            { id: 'a', name: 'А', required: true },
            { id: 'b', name: 'Б', required: true },
        ];

        expect(registry.missingRequired(defs, { a: 0 })).toBe('Параметр «Б» обязателен.');
        expect(registry.missingRequired(defs, { a: '', b: 1 })).toBe('Параметр «А» обязателен.');
        expect(registry.missingRequired(defs, { a: 0, b: false })).toBeUndefined();
        expect(registry.missingRequired(undefined, {})).toBeUndefined();
    });
});
