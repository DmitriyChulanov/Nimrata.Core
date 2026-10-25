/** Запись журнала в виде, в котором её отдаёт `GET /api/journal` */
export interface JournalEntry {
    id: number;
    changesetId: string;
    /** Время набора изменений (ISO, UTC) */
    at: string;
    /** E-mail автора */
    user: string;
    objectId: string;
    operation: 'create' | 'update' | 'move' | 'delete';
    /** Имя свойства (для `update`) */
    property: string | null;
    old: unknown;
    new: unknown;
    /** Полный снимок удалённого объекта (для `delete`) */
    snapshot: unknown;
}

export interface JournalPage {
    items: JournalEntry[];
    total: number;
}

/** Размер страницы журнала */
export const JOURNAL_PAGE_SIZE = 50;

/** Что нужно знать об окружении, чтобы описать запись по-человечески */
export interface JournalResolver {
    typeName(typeId: string): string;
    propertyName(typeId: string | null, propertyId: string): string;
    /** Подпись существующего объекта; `null`, если объекта нет (например, удалён) */
    objectLabel(objectId: string): string | null;
    /** Тип существующего объекта; `null`, если объекта нет */
    objectTypeId(objectId: string): string | null;
}

export interface EntryDescription {
    /** Что произошло: «Создан объект …», имя свойства, «Перенесён» */
    what: string;
    was: string;
    became: string;
}

const EMPTY = '—';

export function journalPath(objectId: string | null, skip: number): string {
    const object = objectId ? `objectId=${encodeURIComponent(objectId)}&` : '';
    return `journal?${object}skip=${skip}&take=${JOURNAL_PAGE_SIZE}`;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function formatValue(value: unknown, resolver: JournalResolver): string {
    if (value === null || value === undefined) return EMPTY;
    if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
    if (typeof value === 'string') return resolver.objectLabel(value) ?? value;
    return JSON.stringify(value);
}

function parentText(parent: unknown, resolver: JournalResolver): string {
    if (parent === null || parent === undefined) return 'в корне';
    const label = typeof parent === 'string' ? resolver.objectLabel(parent) : null;
    return label ? `в «${label}»` : 'в удалённом объекте';
}

/** Превращает запись журнала в три строки для таблицы */
export function describeEntry(entry: JournalEntry, resolver: JournalResolver): EntryDescription {
    switch (entry.operation) {
        case 'create': {
            const type = asRecord(entry.new).type;
            const name = typeof type === 'string' ? resolver.typeName(type) : 'объект';
            return { what: `Создан объект «${name}»`, was: EMPTY, became: EMPTY };
        }
        case 'delete': {
            const type = asRecord(entry.snapshot).type;
            const name = typeof type === 'string' ? resolver.typeName(type) : 'объект';
            return { what: `Удалён объект «${name}»`, was: EMPTY, became: EMPTY };
        }
        case 'move': {
            const was = asRecord(entry.old);
            const became = asRecord(entry.new);
            if (was.parent !== became.parent) {
                return {
                    what: 'Перенесён',
                    was: parentText(was.parent, resolver),
                    became: parentText(became.parent, resolver),
                };
            }
            return {
                what: 'Перенесён',
                was: `порядок ${formatValue(was.order, resolver)}`,
                became: `порядок ${formatValue(became.order, resolver)}`,
            };
        }
        case 'update':
        default: {
            const property = entry.property ?? EMPTY;
            return {
                what: resolver.propertyName(resolver.objectTypeId(entry.objectId), property),
                was: formatValue(entry.old, resolver),
                became: formatValue(entry.new, resolver),
            };
        }
    }
}

/** Записи одного набора изменений (одно действие пользователя) */
export interface ChangesetGroup {
    changesetId: string;
    entries: JournalEntry[];
}

/** Группирует записи по наборам изменений в порядке появления */
export function groupByChangeset(entries: readonly JournalEntry[]): ChangesetGroup[] {
    const groups = new Map<string, ChangesetGroup>();
    for (const entry of entries) {
        const group = groups.get(entry.changesetId);
        if (group) group.entries.push(entry);
        else groups.set(entry.changesetId, { changesetId: entry.changesetId, entries: [entry] });
    }
    return [...groups.values()];
}

export function formatTime(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ru-RU');
}
