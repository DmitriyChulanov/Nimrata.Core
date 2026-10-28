import { describe, expect, it } from 'vitest';

import { createDataController, findSettingsNode } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import { templateOptions } from './categoryTemplates';
import manifest from './manifest.json';
import { ensureTasksStart, registerTasks } from './tasksExtension';

import type { DataController, DataObject, TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

async function start() {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    registerTasks(data);
    await ensureTasksStart(data);
    return { api, data };
}

function group(data: DataController): DataObject {
    const settings = findSettingsNode(data, 'TasksSettings')!;
    return data.getChildren(settings.id).find((o) => o.type === 'CategoryTemplates')!;
}

async function addTemplate(data: DataController, name: string) {
    const created = await data.create({ type: 'CategoryTemplate', parent: group(data).id });
    if (!created.ok) throw new Error(created.error);
    const named = await data.setProperty(created.id, 'name', name);
    if (!named.ok) throw new Error(named.error);
    return created.id;
}

function current(data: DataController) {
    return data
        .getChildren(null)
        .flatMap((o) => data.getChildren(o.id))
        .find((o) => o.type === 'CurrentTasksRoot')!;
}

/**
 * Создаёт день `2026-03-05` и возвращает его
 */
async function seedDay(data: DataController) {
    await data.runAction(current(data).id, 'createTask', { title: 'Первая', date: '2026-03-05' });
    const month = data.getChildren(current(data).id)[0];
    return data.getChildren(month.id)[0];
}

/**
 * Типовые категории Трекера задач (настройки)
 */
describe('Tracker: category templates', () => {
    /**
     * Проверяет, что стартовая структура содержит «Настройки» → «Трекер задач» → «Категории задач»
     */
    it('ensureTasksStart_createsSettingsChainOnce', async () => {
        const { api, data } = await start();

        const root = data.getChildren(null).find((o) => o.type === 'SettingsRoot')!;
        expect(data.getChildren(root.id).map((o) => o.type)).toEqual(['TasksSettings']);
        expect(group(data)).toBeDefined();
        const sent = api.changesets.length;
        await ensureTasksStart(data);
        expect(api.changesets).toHaveLength(sent);
    });

    /**
     * Проверяет, что без типовых категорий список вариантов пуст, а с ними начинается с «Без категории»
     */
    it('templateOptions_withAndWithoutTemplates_hidesOrListsWithNone', async () => {
        const { data } = await start();
        expect(templateOptions(data)).toEqual([]);

        const id = await addTemplate(data, 'Работа');

        expect(templateOptions(data)).toEqual([
            { value: 'none', name: 'Без категории' },
            { value: id, name: 'Работа' },
        ]);
    });

    /**
     * Проверяет, что повтор названия и пустое название типовой категории отклоняются
     */
    it('categoryTemplate_duplicateOrEmptyName_isRejected', async () => {
        const { data } = await start();
        await addTemplate(data, 'Работа');
        const other = await addTemplate(data, 'Дом');

        const duplicate = await data.setProperty(other, 'name', 'Работа');
        const empty = await data.setProperty(other, 'name', '  ');

        expect(duplicate.ok).toBe(false);
        expect(empty.ok).toBe(false);
        expect(data.getObject(other)!.properties.name).toBe('Дом');
    });

    /**
     * Проверяет, что служебные узлы настроек нельзя удалить
     */
    it('settingsNodes_remove_isRejected', async () => {
        const { data } = await start();
        const settings = findSettingsNode(data, 'TasksSettings')!;

        expect((await data.remove(group(data).id)).ok).toBe(false);
        expect((await data.remove(settings.id)).ok).toBe(false);
        expect((await data.remove(settings.parent!)).ok).toBe(false);
    });

    /**
     * Проверяет, что задача по типовой категории попадает в существующую категорию дня, а при её
     * отсутствии категория создаётся
     */
    it('createTask_withTemplate_reusesOrCreatesCategoryInDay', async () => {
        const { data } = await start();
        const template = await addTemplate(data, 'Работа');
        const day = await seedDay(data);

        for (const title of ['А', 'Б']) {
            const result = await data.runAction(day.id, 'createTask', { title, template });
            expect(result.ok).toBe(true);
        }

        const categories = data.getChildren(day.id).filter((o) => o.type === 'Category');
        expect(categories.map((c) => c.properties.name)).toEqual(['Работа']);
        expect(
            data
                .getChildren(categories[0].id)
                .map((t) => t.properties.title)
                .sort(),
        ).toEqual(['А', 'Б']);
    });

    /**
     * Проверяет, что «Без категории» кладёт задачу в день, а удалённая типовая категория — ошибка
     */
    it('createTask_noneOrDeletedTemplate_putsInDayOrFails', async () => {
        const { data } = await start();
        const template = await addTemplate(data, 'Работа');
        const day = await seedDay(data);

        const none = await data.runAction(day.id, 'createTask', { title: 'Без', template: 'none' });
        await data.remove(template);
        const gone = await data.runAction(day.id, 'createTask', { title: 'Нет', template });

        expect(none.ok).toBe(true);
        expect(data.getChildren(day.id).some((o) => o.properties.title === 'Без')).toBe(true);
        expect(gone).toMatchObject({ ok: false, error: 'Типовая категория не найдена.' });
    });
});
