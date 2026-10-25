import type { ChangeScope, DataController, DataObject, HookResult } from '@platform';

import { CURRENT_TASKS_ROOT, DAY_TYPES, TASK } from './constants';
import { parseIso, todayIso } from './dates';
import { ancestors, createNode, ensureCategory, ensureDay, findRoot } from './nodes';
import { cancelIfFailed } from './results';

const TIME = /^\d{2}:\d{2}$/;

/** Имя задачи: «HH:mm — Название» при наличии времени. */
export function taskName(task: DataObject): string | undefined {
    const title = task.properties.title;
    if (typeof title !== 'string' || title === '') return undefined;
    const time = task.properties.time;
    return typeof time === 'string' && TIME.test(time) ? `${time} — ${title}` : title;
}

/** Порядок задачи среди соседей: без времени — 0, иначе 1 + минуты от полуночи. */
export function taskOrder(task: DataObject): number {
    const time = task.properties.time;
    if (typeof time !== 'string' || !TIME.test(time)) return 0;
    return 1 + Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

/** Приводит имя и порядок задачи (по времени) к вычисленным значениям в том же наборе изменений. */
export function syncTask(data: DataController, id: string, tx: ChangeScope): HookResult {
    const task = data.getObject(id);
    if (!task) return;
    const name = taskName(task);
    if (name !== undefined && task.properties.name !== name) {
        const failed = cancelIfFailed(tx.setProperty(id, 'name', name));
        if (failed) return failed;
    }
    const order = taskOrder(task);
    if (task.order !== order) return cancelIfFailed(tx.move(id, { order }));
}

/** Дата задачи (`ГГГГ-ММ-ДД`) берётся из ближайшего родителя-дня; нигде не хранится. */
export function taskDate(data: DataController, task: DataObject): string | undefined {
    for (let id = task.parent; id;) {
        const parent = data.getObject(id);
        if (!parent) return undefined;
        if (DAY_TYPES.includes(parent.type)) {
            const date = parent.properties.date;
            return typeof date === 'string' ? date : undefined;
        }
        id = parent.parent;
    }
    return undefined;
}

/** Все задачи дерева (текущие и архив). */
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
 */
export function createTaskAction(data: DataController) {
    return ({
        object,
        params,
        tx,
    }: {
        object: DataObject;
        params: Record<string, unknown>;
        tx: ChangeScope;
    }) => {
        const title = typeof params.title === 'string' ? params.title.trim() : '';
        if (title === '') throw new Error('Укажите название задачи.');

        const chain = [object, ...ancestors(data, object)];
        const day = chain.find((o) => DAY_TYPES.includes(o.type));
        const inCurrent = chain.some((o) => o.type === CURRENT_TASKS_ROOT);
        // День запуска в архиве датой по умолчанию не служит: берётся сегодня.
        const targetDate =
            inCurrent && typeof day?.properties.date === 'string' ? day.properties.date : '';
        const rawDate = typeof params.date === 'string' && params.date !== '' ? params.date : '';
        const iso = rawDate || targetDate || todayIso();
        const ymd = parseIso(iso);
        if (!ymd) throw new Error('Дата должна быть в формате ГГГГ-ММ-ДД.');

        let container: string;
        if (day && iso === targetDate) {
            // Запуск на дне или внутри дня с той же датой: остаёмся на месте (в своей категории).
            container = object.id;
        } else {
            const root = findRoot(data, CURRENT_TASKS_ROOT, object);
            if (!root) throw new Error('Не найдена группа «Текущие задачи».');
            container = ensureDay(data, tx, root.id, ymd);
        }

        const category = typeof params.category === 'string' ? params.category.trim() : '';
        if (category !== '') container = ensureCategory(data, tx, container, category);

        createNode(tx, container, TASK, { title });
    };
}
