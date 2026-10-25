import { registerCompletion } from './completion';
import { TASK, createTaskAction, syncTask } from './tasks';
import type { ChangeResult, ChangeScope, DataController, DataObject, HookResult } from '@platform';

import { registerQuickAccess } from './quickAccess';

/** Заметка: свойства `title` (вводит пользователь) и `name` (вычисляется, видно в дереве). */
const NOTE = 'Note';

/** Подпись статуса заметки по описанию типа; `undefined`, если статус не задан или неизвестен. */
function statusLabel(data: DataController, status: unknown): string | undefined {
    if (typeof status !== 'string' || status === '') return undefined;
    const property = data.getType(NOTE)?.properties?.find((p) => p.id === 'status');
    return property?.values?.find((v) => v.value === status)?.name;
}

/** Имя заметки: «[Статус] Название», если статус задан, иначе название. */
export function noteName(data: DataController, note: DataObject): string | undefined {
    const title = note.properties.title;
    if (typeof title !== 'string' || title === '') return undefined;
    const label = statusLabel(data, note.properties.status);
    return label ? `[${label}] ${title}` : title;
}

/** Приводит `name` заметки к вычисленному значению в том же наборе изменений. */
function syncNoteName(data: DataController, id: string, tx: ChangeScope): HookResult {
    const note = data.getObject(id);
    if (!note) return;
    const name = noteName(data, note);
    if (name === undefined || note.properties.name === name) return;
    const result = tx.setProperty(id, 'name', name);
    if (!result.ok) return { cancel: result.error };
}

export { taskDate } from './tasks';

function requireText(value: unknown, message: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(message);
    return value.trim();
}

function createIn(
    tx: ChangeScope,
    parent: string,
    type: string,
    properties: Record<string, unknown>,
) {
    const result = tx.create({ type, parent, properties });
    if (!result.ok) throw new Error(result.error);
}

/** Безопасный адрес для перехода: только http и https. */
function safeUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value.trim());
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

/** Связь логики Трекера с интерфейсом. */
export interface TrackerOptions {
    /** Показывает объект в дереве (выделяет и раскрывает родителей); нужен для перехода по внутренней ссылке. */
    reveal?: (id: string) => void;
}

/**
 * Подключает логику Трекера к контроллеру данных: вычисление имён и действия.
 * Возвращает функцию отписки.
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

    for (const parentType of ['CurrentTasksRoot', 'Month', 'Day', 'DayOff', 'Category']) {
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

    for (const parentType of ['NotesRoot', 'NoteGroup']) {
        disposers.push(
            data.registerAction(parentType, 'createNote', ({ object, params, tx }) => {
                const title = requireText(params.title, 'Укажите название заметки.');
                createIn(tx, object.id, NOTE, { title });
            }),
            data.registerAction(parentType, 'createNoteGroup', ({ object, params, tx }) => {
                const name = requireText(params.name, 'Укажите название группы.');
                createIn(tx, object.id, 'NoteGroup', { name });
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

    disposers.push(registerQuickAccess(data), registerCompletion(data));

    return () => disposers.forEach((dispose) => dispose());
}

/**
 * Создаёт стартовую структуру («Задачи» с «Текущие задачи» и «Завершённые задачи», «Заметки»),
 * если соответствующих корней у пользователя ещё нет. Одним набором изменений; при повторном
 * входе, когда корни уже есть, ничего не отправляет.
 */
export async function ensureStartStructure(data: DataController): Promise<ChangeResult> {
    const roots = data.getChildren(null);
    const needTasks = !roots.some((o) => o.type === 'TasksRoot');
    const needNotes = !roots.some((o) => o.type === 'NotesRoot');
    if (!needTasks && !needNotes) return { ok: true };

    return data.perform((tx) => {
        const make = (type: string, parent: string | null) => {
            const result = tx.create({ type, parent });
            if (!result.ok) throw new Error(result.error);
            return result.id;
        };
        if (needTasks) {
            const tasks = make('TasksRoot', null);
            make('CurrentTasksRoot', tasks);
            make('CompletedTasksRoot', tasks);
        }
        if (needNotes) make('NotesRoot', null);
    });
}
