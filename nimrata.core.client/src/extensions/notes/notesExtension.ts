import {
    ancestors,
    createNode,
    ensureCreated,
    orThrow,
    registerOpenExternalLink,
    registerOpenInternalLink,
} from '@platform';

import { ACTIVE_NOTES_ROOT, COMPLETED_NOTES_ROOT, NOTE, NOTES_ROOT, NOTE_GROUP } from './constants';
import { registerQuickAccess } from './quickAccess';

import type {
    ChangeResult,
    ChangeScope,
    DataController,
    DataObject,
    ExtensionDescriptor,
    ExtensionOptions,
} from '@platform';

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
 * Лежит ли объект в «Активных» заметках (или сам является их корнем)
 *
 * @param data - контроллер данных
 * @param object - проверяемый объект
 * @returns `true`, если среди самого объекта и его предков есть корень «Активные»
 */
function isInActive(data: DataController, object: DataObject): boolean {
    return (
        object.type === ACTIVE_NOTES_ROOT ||
        ancestors(data, object).some((o) => o.type === ACTIVE_NOTES_ROOT)
    );
}

/**
 * Переносит заметку из «Активных» в «Завершённые»: цепочка групп воспроизводится по названиям
 * (существующая группа переиспользуется, недостающая создаётся), пустая группа в активных остаётся
 *
 * @param data - контроллер данных
 * @param note - завершаемая заметка
 * @param tx - область изменений
 */
function completeNote(data: DataController, note: DataObject, tx: ChangeScope): void {
    const chain = ancestors(data, note);
    const activeIndex = chain.findIndex((o) => o.type === ACTIVE_NOTES_ROOT);
    const active = chain[activeIndex];
    const notesRoot = chain[activeIndex + 1];
    const completed =
        notesRoot && data.getChildren(notesRoot.id).find((o) => o.type === COMPLETED_NOTES_ROOT);
    if (!active || !completed) throw new Error('Не найден раздел «Завершённые» заметки.');

    const names = chain
        .slice(0, activeIndex)
        .reverse()
        .map((group) => String(group.properties.name ?? ''));

    let container = completed.id;
    for (const name of names) {
        const existing = data
            .getChildren(container)
            .find((o) => o.type === NOTE_GROUP && o.properties.name === name);
        container = existing?.id ?? createNode(tx, container, NOTE_GROUP, { name });
    }
    // В завершённых заметка встаёт последней среди соседей
    const number = data.getChildren(container).reduce((max, o) => Math.max(max, o.number), 0) + 1;
    orThrow(tx.move(note.id, { parent: container, number }));
}

/**
 * Подключает логику Трекера заметок к контроллеру данных: действия создания
 * (только в «Активных»), «Завершить», внешняя и внутренняя ссылки и быстрый доступ. Возвращает функцию отписки
 *
 * @param data - контроллер данных
 * @returns функция отписки
 */
export function registerNotes(data: DataController, options: ExtensionOptions = {}): () => void {
    const disposers: (() => void)[] = [];

    const inActive = (object: DataObject) => isInActive(data, object);
    for (const parentType of [ACTIVE_NOTES_ROOT, NOTE_GROUP]) {
        disposers.push(
            data.registerAction(
                parentType,
                'createNote',
                ({ object, params, tx }) => {
                    const name = requireText(params.name, 'Укажите имя заметки.');
                    createNode(tx, object.id, NOTE, { name });
                },
                { available: inActive },
            ),
            data.registerAction(
                parentType,
                'createNoteGroup',
                ({ object, params, tx }) => {
                    const name = requireText(params.name, 'Укажите имя группы.');
                    createNode(tx, object.id, NOTE_GROUP, { name });
                },
                { available: inActive },
            ),
        );
    }

    disposers.push(
        data.registerAction(NOTE, 'complete', ({ object, tx }) => completeNote(data, object, tx), {
            available: inActive,
        }),
        registerOpenExternalLink(data, [NOTE]),
        registerOpenInternalLink(data, NOTE, options.reveal),
        registerQuickAccess(data, options.reveal),
    );

    return () => disposers.forEach((dispose) => dispose());
}

/**
 * Создаёт корень «Заметки» с «Активными» и «Завершёнными», если их у пользователя ещё нет.
 * Идемпотентна: достраивает только недостающее; когда всё есть, ничего не отправляет
 *
 * @param data - контроллер данных с загруженными объектами
 * @returns результат; при отказе — причина
 */
export function ensureNotesStart(data: DataController): Promise<ChangeResult> {
    return ensureCreated(data, async () => {
        const existing = data.getChildren(null).find((o) => o.type === NOTES_ROOT);
        const children = existing ? data.getChildren(existing.id) : [];
        const missing = [ACTIVE_NOTES_ROOT, COMPLETED_NOTES_ROOT].filter(
            (type) => !children.some((o) => o.type === type),
        );
        if (existing && missing.length === 0) return { ok: true };
        return data.perform((tx) => {
            const root = existing?.id ?? createNode(tx, null, NOTES_ROOT);
            for (const type of missing) createNode(tx, root, type);
        });
    });
}

/**
 * Клиентский дескриптор расширения «Трекер заметок»
 */
export const notesExtension: ExtensionDescriptor = {
    id: 'notes',
    register: registerNotes,
    ensureStart: ensureNotesStart,
};
