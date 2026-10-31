import { describe, expect, it } from 'vitest';

import { createDataController, findSettingsNode } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import { categoryChainFromTemplate } from './categoryTemplates';
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

async function addTemplate(data: DataController, name: string, parent?: string) {
    const created = await data.create({
        type: 'CategoryTemplate',
        parent: parent ?? group(data).id,
    });
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
    await data.runAction(current(data).id, 'createTask', { name: 'Первая', date: '2026-03-05' });
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
     * Проверяет, что цепочка названий идёт от корня иерархии шаблонов до выбранного
     */
    it('categoryChainFromTemplate_nestedTemplate_returnsNamesFromRoot', async () => {
        const { data } = await start();
        const home = await addTemplate(data, 'Дом');
        const kitchen = await addTemplate(data, 'Кухня', home);
        const shelf = await addTemplate(data, 'Полка', kitchen);

        expect(categoryChainFromTemplate(data, home)).toEqual(['Дом']);
        expect(categoryChainFromTemplate(data, shelf)).toEqual(['Дом', 'Кухня', 'Полка']);
        expect(categoryChainFromTemplate(data, undefined)).toEqual([]);
        expect(categoryChainFromTemplate(data, 'none')).toEqual([]);
        expect(() => categoryChainFromTemplate(data, 'gone')).toThrow(
            'Типовая категория не найдена.',
        );
    });

    /**
     * Проверяет, что одинаковые названия допустимы на разных ветках, но не среди соседей
     */
    it('categoryTemplate_sameNameInDifferentBranches_isAllowedAmongSiblingsRejected', async () => {
        const { data } = await start();
        const home = await addTemplate(data, 'Дом');
        const work = await addTemplate(data, 'Работа');
        await addTemplate(data, 'Прочее', home);
        const other = await addTemplate(data, 'Другое', work);

        const sameElsewhere = await data.setProperty(other, 'name', 'Прочее');
        const sibling = await addTemplate(data, 'Одно', home);
        const duplicate = await data.setProperty(sibling, 'name', 'Прочее');

        expect(sameElsewhere.ok).toBe(true);
        expect(duplicate.ok).toBe(false);
    });

    /**
     * Проверяет, что удаление шаблона убирает его поддерево
     */
    it('categoryTemplate_remove_removesSubtree', async () => {
        const { data } = await start();
        const home = await addTemplate(data, 'Дом');
        const kitchen = await addTemplate(data, 'Кухня', home);

        const result = await data.remove(home);

        expect(result.ok).toBe(true);
        expect(data.getObject(kitchen)).toBeUndefined();
    });

    /**
     * Проверяет, что шаблон можно перенести под другой шаблон, но не под самого себя или потомка
     */
    it('categoryTemplate_move_underOtherTemplateAllowedButNotIntoOwnSubtree', async () => {
        const { data } = await start();
        const home = await addTemplate(data, 'Дом');
        const work = await addTemplate(data, 'Работа');
        const kitchen = await addTemplate(data, 'Кухня', home);

        const ok = await data.move(work, { parent: kitchen, number: 1 });
        const cycle = await data.move(home, { parent: kitchen, number: 1 });

        expect(ok.ok).toBe(true);
        expect(cycle.ok).toBe(false);
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
            const result = await data.runAction(day.id, 'createTask', { name: title, template });
            expect(result.ok).toBe(true);
        }

        const categories = data.getChildren(day.id).filter((o) => o.type === 'Category');
        expect(categories.map((c) => c.properties.name)).toEqual(['Работа']);
        expect(
            data
                .getChildren(categories[0].id)
                .map((t) => t.properties.name)
                .sort(),
        ).toEqual(['А', 'Б']);
    });

    /**
     * Проверяет, что вложенный шаблон создаёт в дне всю цепочку категорий и переиспользует уровни
     */
    it('createTask_nestedTemplate_createsChainAndReusesLevels', async () => {
        const { data } = await start();
        const home = await addTemplate(data, 'Дом');
        const first = await addTemplate(data, 'Подкатегория 1', home);
        const second = await addTemplate(data, 'Подкатегория 2', home);
        const day = await seedDay(data);

        await data.runAction(day.id, 'createTask', { name: 'А', template: first });
        await data.runAction(day.id, 'createTask', { name: 'Б', template: second });
        await data.runAction(day.id, 'createTask', { name: 'В', template: home });

        const roots = data.getChildren(day.id).filter((o) => o.type === 'Category');
        expect(roots.map((c) => c.properties.name)).toEqual(['Дом']);
        const inner = data.getChildren(roots[0].id).filter((o) => o.type === 'Category');
        expect(inner.map((c) => c.properties.name).sort()).toEqual([
            'Подкатегория 1',
            'Подкатегория 2',
        ]);
        const names = (id: string) => data.getChildren(id).map((t) => t.properties.name);
        expect(names(inner.find((c) => c.properties.name === 'Подкатегория 1')!.id)).toEqual(['А']);
        expect(names(roots[0].id)).toContain('В');
    });

    /**
     * Проверяет, что «Без категории» кладёт задачу в день, а удалённая типовая категория — ошибка
     */
    it('createTask_noneOrDeletedTemplate_putsInDayOrFails', async () => {
        const { data } = await start();
        const template = await addTemplate(data, 'Работа');
        const day = await seedDay(data);

        const none = await data.runAction(day.id, 'createTask', { name: 'Без', template: 'none' });
        await data.remove(template);
        const gone = await data.runAction(day.id, 'createTask', { name: 'Нет', template });

        expect(none.ok).toBe(true);
        expect(data.getChildren(day.id).some((o) => o.properties.name === 'Без')).toBe(true);
        expect(gone).toMatchObject({ ok: false, error: 'Типовая категория не найдена.' });
    });
});
