import {
    createNode,
    ensureCreated,
    registerOpenExternalLink,
    registerOpenInternalLink,
} from '@platform';

import { registerCompletion } from './completion';
import {
    COMPLETED_TASKS_ROOT,
    CURRENT_TASKS_ROOT,
    DAY,
    DAY_OFF,
    CATEGORY,
    MONTH,
    TASK,
    TASKS_ROOT,
} from './constants';
import { NotificationsBinding } from './NotificationsBinding';
import { ensureRepeats, registerRepeats } from './repeats';
import { registerCreateSchedule } from './schedule';
import { registerSelectToday } from './selectToday';
import { createTaskAction, syncTask } from './tasks';

import type {
    ChangeResult,
    DataController,
    ExtensionDescriptor,
    ExtensionOptions,
} from '@platform';

export { taskDate } from './tasks';

/**
 * Подключает логику Трекера задач к контроллеру данных: вычисление имён и порядка, действия,
 * завершение, повторы и команду «Выделить текущий день». Возвращает функцию отписки
 *
 * @param data - контроллер данных
 * @param options - связь с интерфейсом (показ объекта в дереве)
 * @returns функция отписки
 */
export function registerTasks(data: DataController, options: ExtensionOptions = {}): () => void {
    const disposers: (() => void)[] = [];

    disposers.push(
        data.registerHook(TASK, 'create', 'after', (ctx) => syncTask(data, ctx.object.id, ctx.tx)),
        data.registerHook(TASK, 'setProperty', 'after', (ctx) =>
            ctx.property === 'title' || ctx.property === 'time'
                ? syncTask(data, ctx.object.id, ctx.tx)
                : undefined,
        ),
    );

    for (const parentType of [CURRENT_TASKS_ROOT, MONTH, DAY, DAY_OFF, CATEGORY]) {
        disposers.push(data.registerAction(parentType, 'createTask', createTaskAction(data)));
    }

    disposers.push(
        registerOpenInternalLink(data, TASK, options.reveal),
        registerOpenExternalLink(data, [TASK]),
        registerSelectToday(data, options.reveal),
        registerCreateSchedule(data),
        registerCompletion(data),
        registerRepeats(data),
    );

    return () => disposers.forEach((dispose) => dispose());
}

/**
 * Создаёт стартовую структуру Трекера задач («Задачи» с «Текущие задачи» и «Завершённые задачи»),
 * если её у пользователя ещё нет, и достраивает повторы.
 * Идемпотентна: затрагивает только свои корни; при повторном вызове, когда всё есть, ничего
 * не отправляет
 *
 * @param data - контроллер данных с загруженными объектами
 * @returns результат; при отказе — причина
 */
export async function ensureTasksStart(data: DataController): Promise<ChangeResult> {
    const created = await ensureCreated(data, async () => {
        if (data.getChildren(null).some((o) => o.type === TASKS_ROOT)) return { ok: true };
        return data.perform((tx) => {
            const tasks = createNode(tx, null, TASKS_ROOT);
            createNode(tx, tasks, CURRENT_TASKS_ROOT);
            createNode(tx, tasks, COMPLETED_TASKS_ROOT);
        });
    });
    if (!created.ok) return created;
    return ensureRepeats(data);
}

/**
 * Клиентский дескриптор расширения «Трекер задач»
 */
export const tasksExtension: ExtensionDescriptor = {
    id: 'tasks',
    register: registerTasks,
    ensureStart: ensureTasksStart,
    bindings: [NotificationsBinding],
};
