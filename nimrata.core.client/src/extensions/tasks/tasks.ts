import { ancestors, cancelIfFailed, createNode } from '@platform';

import { categoryChainFromTemplate } from './categoryTemplates';
import { CURRENT_TASKS_ROOT, DAY_TYPES, TASK } from './constants';
import { parseIso, todayIso } from './dates';
import { ensureCategory, ensureCategoryChain, ensureDay, findRoot } from './nodes';

import type { ChangeScope, DataController, DataObject, HookResult } from '@platform';

/**
 * Формат времени задачи `ЧЧ:мм`
 */
const TIME = /^\d{2}:\d{2}$/;

/**
 * Название задачи: «HH:mm — Имя» при наличии времени; без имени `undefined` (подпись по умолчанию)
 */
export function taskTitle(task: DataObject): string | undefined {
    const name = task.properties.name;
    if (typeof name !== 'string' || name === '') return undefined;
    const time = task.properties.time;
    return typeof time === 'string' && TIME.test(time) ? `${time} — ${name}` : name;
}

/**
 * Номер задачи среди соседей: без времени — 2, иначе 2 + минуты от полуночи (номер 1 у категорий дня)
 */
export function taskOrder(task: DataObject): number {
    const time = task.properties.time;
    if (typeof time !== 'string' || !TIME.test(time)) return 2;
    return 2 + Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

/**
 * Приводит порядок задачи (по времени) к вычисленному значению в том же наборе изменений
 */
export function syncTaskOrder(data: DataController, id: string, tx: ChangeScope): HookResult {
    const task = data.getObject(id);
    if (!task) return;
    const number = taskOrder(task);
    if (task.number !== number) return cancelIfFailed(tx.move(id, { number }));
}

/**
 * Дата задачи (`ГГГГ-ММ-ДД`) берётся из ближайшего родителя-дня; нигде не хранится
 */
export function taskDate(data: DataController, task: DataObject): string | undefined {
    const day = ancestors(data, task).find((o) => DAY_TYPES.includes(o.type));
    const date = day?.properties.date;
    return typeof date === 'string' ? date : undefined;
}

/**
 * Все задачи дерева (текущие и архив)
 */
export function allTasks(data: DataController): DataObject[] {
    const tasks: DataObject[] = [];
    const walk = (parent: string | null) => {
        for (const object of data.getChildren(parent)) {
            if (object.type === TASK) tasks.push(object);
            else walk(object.id);
        }
    };
    walk(null);
    return tasks;
}

/**
 * Действие «Создать задачу»: узлы месяца и дня создаются по требованию, категория — по названию.
 * Без даты берётся день, на котором запущено действие (если он в «Текущих задачах»), иначе сегодня;
 * в архив («Завершённые задачи») незавершённая задача не попадает никогда.
 * Созданная задача выделяется в дереве через `reveal`
 */
export function createTaskAction(data: DataController, reveal?: (id: string) => void) {
    return ({
        object,
        params,
        tx,
    }: {
        object: DataObject;
        params: Record<string, unknown>;
        tx: ChangeScope;
    }) => {
        const name = typeof params.name === 'string' ? params.name.trim() : '';
        if (name === '') throw new Error('Укажите имя задачи.');

        const chain = [object, ...ancestors(data, object)];
        const day = chain.find((o) => DAY_TYPES.includes(o.type));
        const inCurrent = chain.some((o) => o.type === CURRENT_TASKS_ROOT);
        // День запуска в архиве датой по умолчанию не служит: берётся сегодня
        const targetDate =
            inCurrent && typeof day?.properties.date === 'string' ? day.properties.date : '';
        const rawDate = typeof params.date === 'string' && params.date !== '' ? params.date : '';
        const iso = rawDate || targetDate || todayIso();
        const ymd = parseIso(iso);
        if (!ymd) throw new Error('Дата должна быть в формате ГГГГ-ММ-ДД.');

        let container: string;
        if (day && iso === targetDate) {
            // Запуск на дне или внутри дня с той же датой: остаёмся на месте (в своей категории)
            container = object.id;
        } else {
            const root = findRoot(data, CURRENT_TASKS_ROOT, object);
            if (!root) throw new Error('Не найдена группа «Текущие задачи».');
            container = ensureDay(data, tx, root.id, ymd);
        }

        const templateChain = categoryChainFromTemplate(data, params.template);
        if (templateChain.length > 0) {
            container = ensureCategoryChain(data, tx, container, templateChain);
        } else {
            const category = typeof params.category === 'string' ? params.category.trim() : '';
            if (category !== '') container = ensureCategory(data, tx, container, category);
        }

        // Созданную задачу показываем в дереве и выделяем, как при обычном создании узла
        const id = createNode(tx, container, TASK, { name });
        reveal?.(id);
    };
}
