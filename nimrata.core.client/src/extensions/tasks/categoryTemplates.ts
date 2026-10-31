import { ancestors } from '@platform';

import { CATEGORY_TEMPLATE, NO_TEMPLATE } from './constants';

import type { DataController, DataObject, HookResult } from '@platform';

/**
 * Название типовой категории без пробелов по краям; пустая строка, если оно не задано
 */
function templateName(object: DataObject): string {
    const name = object.properties.name;
    return typeof name === 'string' ? name.trim() : '';
}

/**
 * Названия категорий дня по выбранной типовой категории: от корня иерархии до выбранной
 * («Дом», «Подкатегория 1»); пустой список для пустого выбора
 *
 * @param data - контроллер данных
 * @param value - значение параметра `template`: идентификатор типовой категории
 * @throws если типовая категория или любой её предок-шаблон не найдены либо без названия
 * (например, удалены после открытия диалога)
 */
export function categoryChainFromTemplate(data: DataController, value: unknown): string[] {
    if (value === undefined || value === '' || value === NO_TEMPLATE) return [];
    const template = typeof value === 'string' ? data.getObject(value) : undefined;
    if (template?.type !== CATEGORY_TEMPLATE) throw new Error('Типовая категория не найдена.');
    const chain = [template, ...ancestors(data, template)]
        .filter((o) => o.type === CATEGORY_TEMPLATE)
        .reverse();
    const names = chain.map(templateName);
    if (names.some((name) => name === '')) throw new Error('Типовая категория не найдена.');
    return names;
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
