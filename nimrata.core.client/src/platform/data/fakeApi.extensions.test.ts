import { describe, expect, it } from 'vitest';

import { createFakeApi } from './fakeApi';

const types = [
    { id: 'Root', name: 'Корень', extension: 'a', singleton: true },
    { id: 'Item', name: 'Элемент', extension: 'a' },
    { id: 'Other', name: 'Другой', extension: 'b' },
    { id: 'Platform', name: 'Платформенный' },
];

const catalog = [
    { id: 'a', connected: true },
    { id: 'b', connected: true },
];

const create = (id: string, type: string, parent: string | null) => ({
    op: 'create',
    id,
    type,
    parent,
    number: 1,
    properties: {},
});

const stored = (id: string, type: string) => ({
    id,
    type,
    parent: null,
    number: 1,
    properties: {},
});

/**
 * Подставной API: подключения расширений, скрытие данных и отказы сервера
 */
describe('fakeApi: extension connections', () => {
    /**
     * Проверяет, что каталог отдаёт расширения с полями контракта и значениями по умолчанию
     */
    it('fakeApi_getExtensions_returnsCatalogWithContractFields', async () => {
        const api = createFakeApi(types, [], {
            extensions: [{ id: 'a', name: 'Альфа', connected: false }],
        });
        const items = await api.get<Record<string, unknown>[]>('extensions');
        expect(items).toEqual([
            {
                id: 'a',
                name: 'Альфа',
                description: '',
                icon: 'puzzle',
                defaultEnabled: true,
                commands: [],
                connected: false,
            },
        ]);
    });

    /**
     * Проверяет, что PUT меняет подключение и возвращает обновлённый элемент, а неизвестное расширение даёт 404
     */
    it('fakeApi_putConnection_updatesItemAndUnknownGives404', async () => {
        const api = createFakeApi(types, [], { extensions: catalog });
        const item = await api.put<{ connected: boolean }>('extensions/a/connection', {
            connected: false,
        });
        expect(item).toMatchObject({ id: 'a', connected: false });
        await expect(
            api.put('extensions/zzz/connection', { connected: true }),
        ).rejects.toMatchObject({ status: 404 });
        await expect(api.put('extensions/a/connection', {})).rejects.toMatchObject({
            status: 400,
        });
    });

    /**
     * Проверяет, что объекты отключённого расширения скрыты, а типы платформы видны всегда
     */
    it('fakeApi_disconnectedExtension_hidesItsObjectsButNotPlatformOnes', async () => {
        const api = createFakeApi(
            types,
            [stored('i', 'Item'), stored('o', 'Other'), stored('p', 'Platform')],
            { extensions: catalog },
        );
        await api.put('extensions/a/connection', { connected: false });
        const ids = (await api.get<{ id: string }[]>('objects')).map((o) => o.id);
        expect(ids).toEqual(['o', 'p']);

        await api.put('extensions/a/connection', { connected: true });
        const back = (await api.get<{ id: string }[]>('objects')).map((o) => o.id);
        expect(back).toEqual(['i', 'o', 'p']);
    });

    /**
     * Проверяет, что запись в тип отключённого расширения отклоняется кодом extension_disabled
     */
    it('fakeApi_writeToDisconnectedExtension_isRejectedWithExtensionDisabled', async () => {
        const api = createFakeApi(types, [], { extensions: catalog });
        await api.put('extensions/a/connection', { connected: false });
        await expect(
            api.post('changesets', { operations: [create('i', 'Item', null)] }),
        ).rejects.toMatchObject({ status: 422, code: 'extension_disabled' });
    });

    /**
     * Проверяет, что второй singleton у того же родителя отклоняется 409 singleton_exists, в том числе скрытый
     */
    it('fakeApi_secondSingleton_isRejectedWith409EvenIfFirstIsHidden', async () => {
        const api = createFakeApi(types, [stored('r1', 'Root')], { extensions: catalog });
        await api.put('extensions/a/connection', { connected: true });
        await expect(
            api.post('changesets', { operations: [create('r2', 'Root', null)] }),
        ).rejects.toMatchObject({ status: 409, code: 'singleton_exists' });
    });

    /**
     * Проверяет, что принятый набор сохраняется и виден при следующей загрузке
     */
    it('fakeApi_acceptedChangeset_isVisibleOnNextRead', async () => {
        const api = createFakeApi(types, [], { extensions: catalog });
        await api.post('changesets', { operations: [create('r1', 'Root', null)] });
        const ids = (await api.get<{ id: string }[]>('objects')).map((o) => o.id);
        expect(ids).toEqual(['r1']);
    });

    /**
     * Проверяет, что подготовленный отказ несёт машинный код
     */
    it('fakeApi_rejectNextWithCode_rejectsWithApiErrorCode', async () => {
        const api = createFakeApi(types);
        api.rejectNext(409, 'уже есть', 'singleton_exists');
        await expect(
            api.post('changesets', { operations: [create('x', 'Item', null)] }),
        ).rejects.toMatchObject({ status: 409, code: 'singleton_exists' });
    });
});
