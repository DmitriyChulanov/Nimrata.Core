import { describe, expect, it } from 'vitest';

import { createDataController } from './DataController';
import { createFakeApi, whenSynced } from './fakeApi';

const types = [
    {
        id: 'Item',
        name: 'Элемент',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'name', name: 'Название', kind: 'string' }],
    },
];

const run = { id: 'run', name: 'Запустить' };
const ask = {
    id: 'ask',
    name: 'Спросить',
    parameters: [{ id: 'days', name: 'Дней', kind: 'integer' as const, required: true }],
};

async function setup() {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    return { api, data };
}

/**
 * Контроллер данных: команды (ADR 0004)
 */
describe('DataController: commands', () => {
    /**
     * Проверяет, что команда без обработчика недоступна и не запускается
     */
    it('commands_withoutHandler_unavailableAndNotRun', async () => {
        const { data } = await setup();

        expect(data.isCommandAvailable('run')).toBe(false);
        const result = await data.runCommand(run);
        expect(result.ok).toBe(false);
    });

    /**
     * Проверяет, что зарегистрированная команда доступна, запускается с параметрами и набором,
     * а набор уходит на сервер одним запросом
     */
    it('commands_registered_runsWithParamsAndTxInOneChangeset', async () => {
        const { api, data } = await setup();
        data.registerCommand('ask', ({ params, tx }) => {
            tx.create({
                type: 'Item',
                parent: null,
                properties: { name: `d${String(params.days)}` },
            });
            tx.create({ type: 'Item', parent: null, properties: { name: 'второй' } });
        });

        expect(data.isCommandAvailable('ask')).toBe(true);
        const result = await data.runCommand(ask, { days: 3 });

        expect(result.ok).toBe(true);
        await whenSynced(data);
        expect(api.changesets).toHaveLength(1);
        expect(data.getChildren(null).map((o) => o.properties.name)).toEqual(['d3', 'второй']);
    });

    /**
     * Проверяет, что обязательный параметр проверяется до вызова обработчика
     */
    it('commands_missingRequiredParam_rejectedBeforeHandler', async () => {
        const { data } = await setup();
        let called = 0;
        data.registerCommand('ask', () => {
            called += 1;
        });

        const result = await data.runCommand(ask, {});

        expect(result).toEqual({ ok: false, error: 'Параметр «Дней» обязателен.' });
        expect(called).toBe(0);
    });

    /**
     * Проверяет, что условие доступности скрывает команду и блокирует запуск
     */
    it('commands_availableCondition_hidesAndBlocksRun', async () => {
        const { data } = await setup();
        let enabled = false;
        let called = 0;
        data.registerCommand(
            'run',
            () => {
                called += 1;
            },
            { available: () => enabled },
        );

        expect(data.isCommandAvailable('run')).toBe(false);
        expect((await data.runCommand(run)).ok).toBe(false);
        expect(called).toBe(0);

        enabled = true;
        expect(data.isCommandAvailable('run')).toBe(true);
        expect((await data.runCommand(run)).ok).toBe(true);
        expect(called).toBe(1);
    });

    /**
     * Проверяет, что исключение обработчика возвращается причиной и откатывает набор
     */
    it('commands_handlerThrows_returnsReasonAndRollsBack', async () => {
        const { api, data } = await setup();
        data.registerCommand('run', ({ tx }) => {
            tx.create({ type: 'Item', parent: null, properties: { name: 'x' } });
            throw new Error('Не вышло');
        });

        const result = await data.runCommand(run);

        expect(result).toEqual({ ok: false, error: 'Не вышло' });
        await whenSynced(data);
        expect(api.changesets).toHaveLength(0);
        expect(data.getChildren(null)).toEqual([]);
    });

    /**
     * Проверяет, что отписка снимает обработчик и не снимает более новый
     */
    it('commands_unregister_removesHandlerButNotNewerOne', async () => {
        const { data } = await setup();
        const first = data.registerCommand('run', () => {});
        const second = data.registerCommand('run', () => {});

        first();
        expect(data.isCommandAvailable('run')).toBe(true);
        second();
        expect(data.isCommandAvailable('run')).toBe(false);
    });
});
