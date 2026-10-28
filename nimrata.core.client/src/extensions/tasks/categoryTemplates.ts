import { findSettingsNode } from '@platform';

import { CATEGORY_TEMPLATE, CATEGORY_TEMPLATES, NO_TEMPLATE, TASKS_SETTINGS } from './constants';

import type { DataController, DataObject, EnumValue, HookResult } from '@platform';

/**
 * Название типовой категории без пробелов по краям; пустая строка, если оно не задано
 */
function templateName(object: DataObject): string {
    const name = object.properties.name;
    return typeof name === 'string' ? name.trim() : '';
}

/**
 * Типовые категории пользователя с непустым названием в порядке дерева
 *
 * @param data - контроллер данных
 * @returns объекты типа `CategoryTemplate`
 */
export function categoryTemplates(data: DataController): DataObject[] {
    const settings = findSettingsNode(data, TASKS_SETTINGS);
    const group =
        settings && data.getChildren(settings.id).find((o) => o.type === CATEGORY_TEMPLATES);
    if (!group) return [];
    return data
        .getChildren(group.id)
        .filter((o) => o.type === CATEGORY_TEMPLATE && templateName(o) !== '')
        .sort((a, b) => a.order - b.order || templateName(a).localeCompare(templateName(b), 'ru'));
}

/**
 * Варианты параметра «Типовая категория»: «Без категории» и типовые категории; без типовых
 * категорий список пуст, и диалог параметр не показывает
 *
 * @param data - контроллер данных
 * @returns значения для диалога
 */
export function templateOptions(data: DataController): EnumValue[] {
    const templates = categoryTemplates(data);
    if (templates.length === 0) return [];
    return [
        { value: NO_TEMPLATE, name: 'Без категории' },
        ...templates.map((t) => ({ value: t.id, name: templateName(t) })),
    ];
}

/**
 * Название категории по выбранной типовой; `undefined` для «Без категории» и пустого выбора
 *
 * @param data - контроллер данных
 * @param value - значение параметра `template`
 * @throws если типовая категория не найдена (например, удалена после открытия диалога)
 */
export function categoryFromTemplate(data: DataController, value: unknown): string | undefined {
    if (value === undefined || value === '' || value === NO_TEMPLATE) return undefined;
    const template = typeof value === 'string' ? data.getObject(value) : undefined;
    if (template?.type !== CATEGORY_TEMPLATE || templateName(template) === '') {
        throw new Error('Типовая категория не найдена.');
    }
    return templateName(template);
}

/**
 * Сообщение об отказе для названия типовой категории: пустое или уже занятое среди соседей;
 * `undefined`, если название допустимо
 */
function nameProblem(data: DataController, object: DataObject, name: string): string | undefined {
    if (name === '') return 'Название типовой категории не может быть пустым.';
    const twin = data
        .getChildren(object.parent)
        .some(
            (o) => o.id !== object.id && o.type === CATEGORY_TEMPLATE && templateName(o) === name,
        );
    if (twin) return `Типовая категория «${name}» уже есть.`;
}

/**
 * Подключает проверку названий типовых категорий (непустое, без повторов среди соседей).
 * Свежесозданная категория безымянна, пока пользователь не введёт название; повтор названия
 * при вставке копии отклоняет хук «после» исключением, остальное — хук «до»
 *
 * @param data - контроллер данных
 * @returns функция отписки
 */
export function registerCategoryTemplates(data: DataController): () => void {
    const disposers = [
        data.registerHook(CATEGORY_TEMPLATE, 'create', 'after', (ctx) => {
            const name = templateName(ctx.object);
            const problem = name === '' ? undefined : nameProblem(data, ctx.object, name);
            if (problem) throw new Error(problem);
        }),
        data.registerHook(CATEGORY_TEMPLATE, 'setProperty', 'before', (ctx): HookResult => {
            if (ctx.property !== 'name') return;
            const name = typeof ctx.newValue === 'string' ? ctx.newValue.trim() : '';
            const problem = nameProblem(data, ctx.object, name);
            if (problem) return { cancel: problem };
        }),
    ];
    return () => disposers.forEach((dispose) => dispose());
}
