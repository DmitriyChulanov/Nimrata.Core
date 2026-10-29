import {
    createNode,
    ensureCreated,
    ensureSettingsNode,
    findSettingsNode,
    registerOpenExternalLink,
    registerOpenInternalLink,
    registerSettingsGuard,
} from '@platform';

import { registerCategoryTemplates, templateOptions } from './categoryTemplates';

import { registerCompletion } from './completion';
import {
    COMPLETED_TASKS_ROOT,
    CATEGORY,
    CATEGORY_TEMPLATES,
    CURRENT_TASKS_ROOT,
    DAY_TYPES,
    MONTH,
    TASK,
    TASKS_ROOT,
    TASKS_SETTINGS,
} from './constants';
import { registerCompletedReport } from './completedReport';
import { NotificationsBinding } from './NotificationsBinding';
import { ensureRepeats, registerRepeats } from './repeats';
import { registerCreateSchedule } from './schedule';
import { registerSelectToday } from './selectToday';
import { createTaskAction, syncTaskOrder, taskTitle } from './tasks';

import type {
    ChangeResult,
    DataController,
    ExtensionDescriptor,
    ExtensionOptions,
} from '@platform';

export { taskDate } from './tasks';

/**
 * Подключает логику Трекера задач к контроллеру данных: название и порядок задач, действия,
 * завершение, повторы и команду «Выделить текущий день». Возвращает функцию отписки
 *
 * @param data - контроллер данных
 * @param options - связь с интерфейсом (показ объекта в дереве)
 * @returns функция отписки
 */
export function registerTasks(data: DataController, options: ExtensionOptions = {}): () => void {
    const disposers: (() => void)[] = [];

    disposers.push(
        data.registerTitle(TASK, taskTitle),
        data.registerHook(TASK, 'create', 'after', (ctx) =>
            syncTaskOrder(data, ctx.object.id, ctx.tx),
        ),
        data.registerHook(TASK, 'setProperty', 'after', (ctx) =>
            ctx.property === 'time' ? syncTaskOrder(data, ctx.object.id, ctx.tx) : undefined,
        ),
    );

    for (const parentType of [CURRENT_TASKS_ROOT, MONTH, CATEGORY]) {
        disposers.push(
            data.registerAction(parentType, 'createTask', createTaskAction(data, options.reveal)),
        );
    }
    // У дня выбирается типовая категория; без типовых категорий параметр в диалоге скрыт
    for (const dayType of DAY_TYPES) {
        disposers.push(
            data.registerAction(dayType, 'createTask', createTaskAction(data, options.reveal), {
                parameterValues: { template: () => templateOptions(data) },
            }),
        );
    }

    disposers.push(
        registerCategoryTemplates(data),
        registerSettingsGuard(data, [TASKS_SETTINGS, CATEGORY_TEMPLATES]),
        registerOpenInternalLink(data, TASK, options.reveal),
        registerOpenExternalLink(data, [TASK]),
        registerSelectToday(data, options.reveal),
        registerCompletedReport(data),
        registerCreateSchedule(data),
        registerCompletion(data),
        registerRepeats(data),
    );

    return () => disposers.forEach((dispose) => dispose());
}

/**
 * Создаёт стартовую структуру Трекера задач («Задачи» с «Текущие задачи» и «Завершённые задачи»),
 * если её у пользователя ещё нет, и достраивает повторы;
 * идемпотентна: затрагивает только свои корни; при повторном вызове, когда всё есть, ничего
 * не отправляет
 *
 * @param data - контроллер данных с загруженными объектами
 * @returns результат; при отказе — причина
 */
export async function ensureTasksStart(data: DataController): Promise<ChangeResult> {
    const created = await ensureCreated(data, async () => {
        const hasTasks = data.getChildren(null).some((o) => o.type === TASKS_ROOT);
        const settings = findSettingsNode(data, TASKS_SETTINGS);
        const hasGroup =
            settings && data.getChildren(settings.id).some((o) => o.type === CATEGORY_TEMPLATES);
        if (hasTasks && hasGroup) return { ok: true };
        return data.perform(
            (tx) => {
                if (!hasTasks) {
                    const tasks = createNode(tx, null, TASKS_ROOT);
                    createNode(tx, tasks, CURRENT_TASKS_ROOT);
                    createNode(tx, tasks, COMPLETED_TASKS_ROOT);
                }
                if (!hasGroup)
                    createNode(
                        tx,
                        ensureSettingsNode(data, tx, TASKS_SETTINGS),
                        CATEGORY_TEMPLATES,
                    );
                // Итог сервера нужен ensureCreated: отказ singleton_exists — «уже есть»
            },
            { confirmed: true },
        );
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
