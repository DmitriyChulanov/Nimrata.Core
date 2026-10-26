import { registerCompletion } from './completion';
import {
    COMPLETED_TASKS_ROOT,
    CURRENT_TASKS_ROOT,
    DAY,
    DAY_OFF,
    CATEGORY,
    MONTH,
    NOTE,
    NOTES_ROOT,
    NOTE_GROUP,
    SELECT_TODAY,
    TASK,
    TASKS_ROOT,
} from './constants';
import { createNode } from './nodes';
import { registerQuickAccess } from './quickAccess';
import { registerRepeats } from './repeats';
import { cancelIfFailed } from './results';
import { needsSelectToday, registerSelectToday } from './selectToday';
import { createTaskAction, syncTask } from './tasks';

import type { ChangeResult, ChangeScope, DataController, DataObject, HookResult } from '@platform';

/**
 * Подпись статуса заметки по описанию типа; `undefined`, если статус не задан или неизвестен
 */
function statusLabel(data: DataController, status: unknown): string | undefined {
    if (typeof status !== 'string' || status === '') return undefined;
    const property = data.getType(NOTE)?.properties?.find((p) => p.id === 'status');
    return property?.values?.find((v) => v.value === status)?.name;
}

/**
 * Имя заметки: «[Статус] Название», если статус задан, иначе название
 */
export function noteName(data: DataController, note: DataObject): string | undefined {
    const title = note.properties.title;
    if (typeof title !== 'string' || title === '') return undefined;
    const label = statusLabel(data, note.properties.status);
    return label ? `[${label}] ${title}` : title;
}

/**
 * Приводит `name` заметки к вычисленному значению в том же наборе изменений
 */
function syncNoteName(data: DataController, id: string, tx: ChangeScope): HookResult {
    const note = data.getObject(id);
    if (!note) return;
    const name = noteName(data, note);
    if (name === undefined || note.properties.name === name) return;
    return cancelIfFailed(tx.setProperty(id, 'name', name));
}

export { taskDate } from './tasks';

/**
 * Проверяет, что значение — непустая строка
 *
 * @param value - проверяемое значение
 * @param message - текст ошибки при неудаче
 * @returns строка без пробелов по краям
 */
function requireText(value: unknown, message: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(message);
    return value.trim();
}

/**
 * Безопасный адрес для перехода: только http и https
 */
function safeUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value.trim());
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

/**
 * Связь логики Трекера с интерфейсом
 */
export interface TrackerOptions {
    /** Показывает объект в дереве (выделяет и раскрывает родителей); нужен для перехода по внутренней ссылке */
    reveal?: (id: string) => void;
}

/**
 * Подключает логику Трекера к контроллеру данных: вычисление имён и действия.
 * Возвращает функцию отписки
 */
export function registerTracker(data: DataController, options: TrackerOptions = {}): () => void {
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
        data.registerAction(
            TASK,
            'openInternalLink',
            ({ object }) => {
                const target = object.properties.internalLink;
                if (typeof target !== 'string' || !data.getObject(target)) {
                    throw new Error('Объект по ссылке недоступен.');
                }
                options.reveal?.(target);
            },
            {
                available: (object) =>
                    typeof object.properties.internalLink === 'string' &&
                    object.properties.internalLink !== '',
            },
        ),
    );

    disposers.push(
        data.registerHook(NOTE, 'create', 'after', (ctx) =>
            syncNoteName(data, ctx.object.id, ctx.tx),
        ),
        data.registerHook(NOTE, 'setProperty', 'after', (ctx) =>
            ctx.property === 'title' || ctx.property === 'status'
                ? syncNoteName(data, ctx.object.id, ctx.tx)
                : undefined,
        ),
    );

    for (const parentType of [NOTES_ROOT, NOTE_GROUP]) {
        disposers.push(
            data.registerAction(parentType, 'createNote', ({ object, params, tx }) => {
                const title = requireText(params.title, 'Укажите название заметки.');
                createNode(tx, object.id, NOTE, { title });
            }),
            data.registerAction(parentType, 'createNoteGroup', ({ object, params, tx }) => {
                const name = requireText(params.name, 'Укажите название группы.');
                createNode(tx, object.id, NOTE_GROUP, { name });
            }),
        );
    }

    for (const linkType of [NOTE, TASK]) {
        disposers.push(
            data.registerAction(
                linkType,
                'openExternalLink',
                ({ object }) => {
                    const url = safeUrl(object.properties.link);
                    if (!url) throw new Error('Ссылка должна начинаться с http:// или https://.');
                    window.open(url, '_blank', 'noopener,noreferrer');
                },
                {
                    available: (object) =>
                        typeof object.properties.link === 'string' && object.properties.link !== '',
                },
            ),
        );
    }

    disposers.push(
        registerQuickAccess(data),
        registerSelectToday(data, options.reveal),
        registerCompletion(data),
        registerRepeats(data),
    );

    return () => disposers.forEach((dispose) => dispose());
}

/**
 * Создаёт стартовую структуру («Задачи» с «Текущие задачи» и «Завершённые задачи», «Заметки»),
 * если соответствующих корней у пользователя ещё нет. Одним набором изменений; при повторном
 * входе, когда корни уже есть, ничего не отправляет
 */
export async function ensureStartStructure(data: DataController): Promise<ChangeResult> {
    const roots = data.getChildren(null);
    const needTasks = !roots.some((o) => o.type === TASKS_ROOT);
    const needNotes = !roots.some((o) => o.type === NOTES_ROOT);
    const needSelectToday = needsSelectToday(data);
    if (!needTasks && !needNotes && !needSelectToday) return { ok: true };

    return data.perform((tx) => {
        if (needTasks) {
            const tasks = createNode(tx, null, TASKS_ROOT);
            createNode(tx, tasks, CURRENT_TASKS_ROOT);
            createNode(tx, tasks, COMPLETED_TASKS_ROOT);
        }
        if (needNotes) createNode(tx, null, NOTES_ROOT);
        if (needSelectToday) createNode(tx, null, SELECT_TODAY);
    });
}
