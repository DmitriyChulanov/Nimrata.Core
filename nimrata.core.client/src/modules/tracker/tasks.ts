import type { ChangeScope, DataController, DataObject, HookResult } from '@platform';

/** Типы узлов дерева задач. */
export const TASK = 'Task';
const MONTH = 'Month';
export const CATEGORY = 'Category';
/** Категории дня идут перед задачами (у задач порядок не меньше 0). */
const CATEGORY_ORDER = -1;
export const DAY_TYPES = ['Day', 'DayOff'];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^\d{2}:\d{2}$/;

const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });
const weekdayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', timeZone: 'UTC' });

interface Ymd {
    year: number;
    month: number;
    day: number;
}

export function parseIso(value: string): Ymd | null {
    const match = ISO_DATE.exec(value);
    if (!match) return null;
    const ymd = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    const check = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
    const valid =
        check.getUTCFullYear() === ymd.year &&
        check.getUTCMonth() === ymd.month - 1 &&
        check.getUTCDate() === ymd.day;
    return valid ? ymd : null;
}

function utc({ year, month, day }: Ymd): Date {
    return new Date(Date.UTC(year, month - 1, day));
}

export const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Сегодняшняя дата по местному времени в виде `ГГГГ-ММ-ДД`. */
export function todayIso(): string {
    const now = new Date();
    return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Имя месяца: «MMMM, yyyy». */
export function monthName(ymd: Ymd): string {
    return `${monthFormat.format(utc(ymd))}, ${ymd.year}`;
}

/** Имя дня: «dd.MM.yyyy, dddd». */
export function dayName(ymd: Ymd): string {
    return `${pad(ymd.day)}.${pad(ymd.month)}.${pad(ymd.year, 4)}, ${weekdayFormat.format(utc(ymd))}`;
}

/** Суббота или воскресенье. */
export function isWeekend(ymd: Ymd): boolean {
    const weekday = utc(ymd).getUTCDay();
    return weekday === 0 || weekday === 6;
}

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

/** Приводит  и порядок задачи (по времени) к вычисленным значениям в том же наборе изменений. */
export function syncTask(data: DataController, id: string, tx: ChangeScope): HookResult {
    const task = data.getObject(id);
    if (!task) return;
    const name = taskName(task);
    if (name !== undefined && task.properties.name !== name) {
        const result = tx.setProperty(id, 'name', name);
        if (!result.ok) return { cancel: result.error };
    }
    const order = taskOrder(task);
    if (task.order !== order) {
        const result = tx.move(id, { order });
        if (!result.ok) return { cancel: result.error };
    }
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

export function create(
    tx: ChangeScope,
    parent: string,
    type: string,
    properties: Record<string, unknown>,
    order?: number,
): string {
    const result = tx.create({ type, parent, properties, order });
    if (!result.ok) throw new Error(result.error);
    return result.id;
}

export function child(
    data: DataController,
    parent: string,
    type: string,
    match: (o: DataObject) => boolean,
) {
    return data.getChildren(parent).find((o) => o.type === type && match(o));
}

/** Находит или создаёт месяц и день внутри «Текущих задач»; возвращает идентификатор дня. */
export function ensureDay(
    data: DataController,
    tx: ChangeScope,
    rootId: string,
    date: Ymd,
): string {
    const monthDate = `${pad(date.year, 4)}-${pad(date.month)}-01`;
    const month =
        child(data, rootId, MONTH, (o) => o.properties.date === monthDate)?.id ??
        create(
            tx,
            rootId,
            MONTH,
            { date: monthDate, name: monthName(date) },
            date.year * 12 + date.month - 1,
        );
    const dayDate = `${monthDate.slice(0, 8)}${pad(date.day)}`;
    const existing = data
        .getChildren(month)
        .find((o) => DAY_TYPES.includes(o.type) && o.properties.date === dayDate);
    if (existing) return existing.id;
    return create(
        tx,
        month,
        isWeekend(date) ? 'DayOff' : 'Day',
        { date: dayDate, name: dayName(date) },
        date.day,
    );
}

/** Находит категорию с таким названием внутри родителя или создаёт её. */
export function ensureCategory(
    data: DataController,
    tx: ChangeScope,
    parent: string,
    name: string,
): string {
    return (
        child(data, parent, CATEGORY, (o) => o.properties.name === name)?.id ??
        create(tx, parent, CATEGORY, { name }, CATEGORY_ORDER)
    );
}

export function ancestors(data: DataController, object: DataObject): DataObject[] {
    const chain: DataObject[] = [];
    for (let id = object.parent; id;) {
        const parent = data.getObject(id);
        if (!parent) break;
        chain.push(parent);
        id = parent.parent;
    }
    return chain;
}

/** Действие «Создать задачу»: узлы месяца и дня создаются по требованию, категория — по названию. */
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
        const targetDate = typeof day?.properties.date === 'string' ? day.properties.date : '';
        const rawDate = typeof params.date === 'string' && params.date !== '' ? params.date : '';
        const iso = rawDate || targetDate || todayIso();
        const ymd = parseIso(iso);
        if (!ymd) throw new Error('Дата должна быть в формате ГГГГ-ММ-ДД.');

        const root = chain.find((o) => o.type === 'CurrentTasksRoot');
        let container: string;
        if (root && day && iso === targetDate) {
            // Запуск на дне или внутри дня с той же датой: остаёмся на месте (в своей категории).
            container = object.id;
        } else {
            const rootId =
                root?.id ??
                data
                    .getChildren(null)
                    .filter((o) => o.type === 'TasksRoot')
                    .flatMap((o) => data.getChildren(o.id))
                    .find((o) => o.type === 'CurrentTasksRoot')?.id;
            if (!rootId) throw new Error('Не найдена группа «Текущие задачи».');
            container = ensureDay(data, tx, rootId, ymd);
        }

        const category = typeof params.category === 'string' ? params.category.trim() : '';
        if (category !== '') container = ensureCategory(data, tx, container, category);

        create(tx, container, TASK, { title });
    };
}
