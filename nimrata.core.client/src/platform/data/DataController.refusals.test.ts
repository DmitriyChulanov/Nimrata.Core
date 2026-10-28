import { describe, expect, it } from 'vitest';

import { createDataController } from './DataController';
import { createFakeApi } from './fakeApi';

const types = [
    {
        id: 'Item',
        name: 'Элемент',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'name', name: 'Название', kind: 'string' }],
        actions: [
            { id: 'mark', name: 'Отметить', placements: ['propertyGrid'] },
            {
                id: 'ask',
                name: 'Спросить',
                parameters: [{ id: 'days', name: 'Дней', kind: 'integer', required: true }],
            },
            { id: 'bare', name: 'Без обработчика' },
        ],
    },
];

const objects = [
    { id: 'a', type: 'Item', parent: null, order: 0, properties: { name: 'Первый' } },
    { id: 'b', type: 'Item', parent: null, order: 1, properties: {} },
];

async function setup() {
    const api = createFakeApi(types, objects);
    const data = createDataController({ api });
    await data.load();
    return { api, data };
}

/**
 * Контроллер данных: отказы запуска действий и команд до исполнения
 */
describe('DataController: refusals before execution', () => {
    /**
     * Проверяет тексты отказов запуска одного объекта и то, что набор на сервер не уходит
     */
    it('runAction_refusals_returnExactReasonsAndWriteNothing', async () => {
        const { api, data } = await setup();
        let called = 0;
        data.registerAction('Item', 'ask', () => void (called += 1));
        data.registerAction('Item', 'mark', () => void (called += 1), {
            available: (object) => object.id !== 'b',
        });

        expect(await data.runAction('zzz', 'mark')).toEqual({
            ok: false,
            error: 'Объект не найден.',
        });
        expect(await data.runAction('a', 'bare')).toEqual({
            ok: false,
            error: 'У объекта нет действия "bare" с обработчиком.',
        });
        expect(await data.runAction('b', 'mark')).toEqual({
            ok: false,
            error: 'У объекта нет действия "mark" с обработчиком.',
        });
        expect(await data.runAction('a', 'ask', { days: '' })).toEqual({
            ok: false,
            error: 'Параметр «Дней» обязателен.',
        });
        expect(called).toBe(0);
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет тексты отказов запуска по группе (с именем объекта) и отсутствие записи на сервер
     */
    it('runActionOnMany_refusals_returnExactReasonsAndWriteNothing', async () => {
        const { api, data } = await setup();
        data.registerAction('Item', 'ask', () => {});
        data.registerAction('Item', 'mark', () => {}, { available: (o) => o.id !== 'b' });

        expect(await data.runActionOnMany(['a', 'zzz'], 'mark')).toEqual({
            ok: false,
            error: 'Объект не найден.',
        });
        expect(await data.runActionOnMany(['a', 'b'], 'mark')).toEqual({
            ok: false,
            error: 'Элемент: у объекта нет действия "mark" с обработчиком.',
        });
        expect(await data.runActionOnMany(['b'], 'mark')).toEqual({
            ok: false,
            error: 'у объекта нет действия "mark" с обработчиком.',
        });
        expect(await data.runActionOnMany(['a', 'b'], 'ask', {})).toEqual({
            ok: false,
            error: 'Параметр «Дней» обязателен.',
        });
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет текст отказа недоступной команды и команды без обязательного параметра
     */
    it('runCommand_refusals_returnExactReasonsAndWriteNothing', async () => {
        const { api, data } = await setup();
        const command = {
            id: 'cmd',
            name: 'Команда',
            parameters: [{ id: 'days', name: 'Дней', kind: 'integer' as const, required: true }],
        };

        expect(await data.runCommand(command)).toEqual({
            ok: false,
            error: 'Команда "cmd" недоступна.',
        });
        data.registerCommand('cmd', () => {});
        expect(await data.runCommand(command, {})).toEqual({
            ok: false,
            error: 'Параметр «Дней» обязателен.',
        });
        expect(api.changesets).toHaveLength(0);
    });

    /**
     * Проверяет, что одиночное действие, недоступное объекту, скрыто, а у группы показано с причиной
     */
    it('getActions_unavailable_hiddenForOneAndShownWithReasonForGroup', async () => {
        const { data } = await setup();
        data.registerAction('Item', 'mark', () => {}, { available: (o) => o.id !== 'b' });

        expect(data.getActions('b', 'propertyGrid')).toEqual([]);
        expect(data.getGroupActions(['b'], 'propertyGrid')).toEqual([]);
        expect(data.getGroupActions(['a', 'b'], 'propertyGrid')[0]?.unavailable).toBe(
            'Недоступно для объекта «Элемент»',
        );
    });
});
