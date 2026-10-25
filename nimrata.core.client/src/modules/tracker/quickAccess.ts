import type { ChangeScope, DataController, DataObject, HookResult } from '@platform';

/** Запись быстрого доступа: механизм (скрыт в дереве) со ссылкой `target` на заметку или группу. */
export const QUICK_ACCESS_ENTRY = 'QuickAccessEntry';

const TARGET_TYPES = ['Note', 'NoteGroup'];

/** Все записи быстрого доступа (лежат среди корневых объектов). */
export function quickAccessEntries(data: DataController): DataObject[] {
    return data.getChildren(null).filter((o) => o.type === QUICK_ACCESS_ENTRY);
}

/** Записи, ссылающиеся на объект `targetId`. */
function entriesOf(data: DataController, targetId: string): DataObject[] {
    return quickAccessEntries(data).filter((e) => e.properties.target === targetId);
}

/** Название цели для записи: вычисляемое имя, а при его отсутствии — название. */
function targetName(target: DataObject): string {
    for (const key of ['name', 'title']) {
        const value = target.properties[key];
        if (typeof value === 'string' && value !== '') return value;
    }
    return '';
}

/** Идентификаторы объекта и всех его потомков. */
function subtreeIds(data: DataController, id: string): Set<string> {
    const ids = new Set<string>();
    const walk = (current: string) => {
        ids.add(current);
        for (const child of data.getChildren(current)) walk(child.id);
    };
    walk(id);
    return ids;
}

function failIfNotOk(result: { ok: boolean; error?: string }) {
    if (!result.ok) throw new Error(result.error);
}

function removeEntries(entries: DataObject[], tx: ChangeScope): HookResult {
    for (const entry of entries) {
        const result = tx.remove(entry.id);
        if (!result.ok) return { cancel: result.error };
    }
}

/**
 * Подключает быстрый доступ: действия «Добавить»/«Убрать» у заметки и группы заметок и хуки,
 * держащие записи в согласии с целями (название при переименовании, удаление вместе с целью).
 * Возвращает функцию отписки.
 */
export function registerQuickAccess(data: DataController): () => void {
    const disposers: (() => void)[] = [];

    for (const type of TARGET_TYPES) {
        disposers.push(
            data.registerAction(
                type,
                'addToQuickAccess',
                ({ object, tx }) => {
                    // Повторное «Добавить» дубля не создаёт.
                    if (entriesOf(data, object.id).length > 0) return;
                    failIfNotOk(
                        tx.create({
                            type: QUICK_ACCESS_ENTRY,
                            parent: null,
                            properties: { name: targetName(object), target: object.id },
                        }),
                    );
                },
                { available: (object) => entriesOf(data, object.id).length === 0 },
            ),
            data.registerAction(
                type,
                'removeFromQuickAccess',
                ({ object, tx }) => {
                    for (const entry of entriesOf(data, object.id))
                        failIfNotOk(tx.remove(entry.id));
                },
                { available: (object) => entriesOf(data, object.id).length > 0 },
            ),
            // Название записи следует за названием цели в том же наборе изменений.
            data.registerHook(type, 'setProperty', 'after', (ctx) => {
                if (ctx.property !== 'name') return;
                const name = typeof ctx.newValue === 'string' ? ctx.newValue : '';
                for (const entry of entriesOf(data, ctx.object.id)) {
                    if (entry.properties.name === name) continue;
                    const result = ctx.tx.setProperty(entry.id, 'name', name);
                    if (!result.ok) return { cancel: result.error };
                }
            }),
        );
    }

    // Удаление цели (в том числе группы с вложенными заметками) убирает записи всего поддерева.
    disposers.push(
        data.registerHook('*', 'remove', 'before', (ctx) => {
            const entries = quickAccessEntries(data);
            if (entries.length === 0 || ctx.object.type === QUICK_ACCESS_ENTRY) return;
            const ids = subtreeIds(data, ctx.object.id);
            return removeEntries(
                entries.filter((e) => ids.has(e.properties.target as string)),
                ctx.tx,
            );
        }),
    );

    return () => disposers.forEach((dispose) => dispose());
}
