import { cancelIfFailed, createNode, ensureCreated, registerOpenExternalLink } from '@platform';

import { NOTE, NOTES_ROOT, NOTE_GROUP } from './constants';
import { registerQuickAccess } from './quickAccess';

import type {
    ChangeResult,
    ChangeScope,
    DataController,
    DataObject,
    ExtensionDescriptor,
    HookResult,
} from '@platform';

/**
 * Подпись статуса заметки по описанию типа
 *
 * @param data - контроллер данных (описание типа даёт подписи статусов)
 * @param status - значение свойства статуса заметки
 * @returns подпись или `undefined`, если статус не задан или неизвестен
 */
function statusLabel(data: DataController, status: unknown): string | undefined {
    if (typeof status !== 'string' || status === '') return undefined;
    const property = data.getType(NOTE)?.properties?.find((p) => p.id === 'status');
    return property?.values?.find((v) => v.value === status)?.name;
}

/**
 * Имя заметки: «[Статус] Название», если статус задан, иначе название
 *
 * @param data - контроллер данных (описание типа даёт подписи статусов)
 * @param note - заметка
 * @returns вычисленное имя или `undefined`, если названия нет
 */
export function noteName(data: DataController, note: DataObject): string | undefined {
    const title = note.properties.title;
    if (typeof title !== 'string' || title === '') return undefined;
    const label = statusLabel(data, note.properties.status);
    return label ? `[${label}] ${title}` : title;
}

/**
 * Приводит `name` заметки к вычисленному значению в том же наборе изменений
 *
 * @param data - контроллер данных
 * @param id - идентификатор заметки
 * @param tx - область изменений текущего набора
 * @returns результат хука: отмена набора, если имя не удалось записать
 */
function syncNoteName(data: DataController, id: string, tx: ChangeScope): HookResult {
    const note = data.getObject(id);
    if (!note) return;
    const name = noteName(data, note);
    if (name === undefined || note.properties.name === name) return;
    return cancelIfFailed(tx.setProperty(id, 'name', name));
}

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
 * Подключает логику Трекера заметок к контроллеру данных: вычисление имён, действия создания,
 * внешняя ссылка и быстрый доступ. Возвращает функцию отписки
 *
 * @param data - контроллер данных
 * @returns функция отписки
 */
export function registerNotes(data: DataController): () => void {
    const disposers: (() => void)[] = [];

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

    disposers.push(registerOpenExternalLink(data, [NOTE]), registerQuickAccess(data));

    return () => disposers.forEach((dispose) => dispose());
}

/**
 * Создаёт корень «Заметки», если его у пользователя ещё нет. Идемпотентна: затрагивает только
 * свой корень; когда он есть, ничего не отправляет
 *
 * @param data - контроллер данных с загруженными объектами
 * @returns результат; при отказе — причина
 */
export function ensureNotesStart(data: DataController): Promise<ChangeResult> {
    return ensureCreated(data, async () => {
        if (data.getChildren(null).some((o) => o.type === NOTES_ROOT)) return { ok: true };
        return data.perform((tx) => {
            createNode(tx, null, NOTES_ROOT);
        });
    });
}

/**
 * Клиентский дескриптор расширения «Трекер заметок»
 */
export const notesExtension: ExtensionDescriptor = {
    id: 'notes',
    register: (data) => registerNotes(data),
    ensureStart: ensureNotesStart,
};
