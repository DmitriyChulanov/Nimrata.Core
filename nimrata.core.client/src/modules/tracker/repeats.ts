import { uuid7 } from '@platform';
import type { ChangeResult, ChangeScope, DataController, DataObject, HookResult } from '@platform';

import { categoryChain, findRoot } from './completion';
import {
    TASK,
    ensureCategory,
    ensureDay,
    create,
    isWeekend,
    pad,
    parseIso,
    taskDate,
    taskName,
    taskOrder,
    todayIso,
} from './tasks';

const NONE = 'none';
const WEEKDAYS = 'weekdays';
const WEEKLY = 'weekly';
const MONTHLY = 'monthly';
const COMPLETED = 'completed';

/** Свойства, правки которых распространяются на весь набор повторов (порядок — отдельно, через `move`). */
const SYNCED = ['title', 'comment', 'link', 'priority', 'time'];
/** Свойства, которые копируются в новый повтор (статус и вычисляемое имя — нет). */
const COPIED = [...SYNCED, 'internalLink', 'notifyBefore', 'repeat', 'repeatId'];

const WEEKEND_MESSAGE = 'Для задачи выходного дня нельзя включить повтор «Каждый будний день».';

interface Ymd {
    year: number;
    month: number;
    day: number;
}

const toIso = ({ year, month, day }: Ymd) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

function fromUtc(date: Date): Ymd {
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function toUtc({ year, month, day }: Ymd): Date {
    return new Date(Date.UTC(year, month - 1, day));
}

function addDays(ymd: Ymd, days: number): Ymd {
    const date = toUtc(ymd);
    date.setUTCDate(date.getUTCDate() + days);
    return fromUtc(date);
}

/** Прибавляет месяцы; если в месяце нет такого числа, берётся его последний день. */
function addMonths(ymd: Ymd, months: number): Ymd {
    const index = ymd.year * 12 + ymd.month - 1 + months;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { year, month, day: Math.min(ymd.day, lastDay) };
}

/** Горизонт повторов: последний день следующего месяца (`ГГГГ-ММ-ДД`). */
export function repeatHorizon(today: string): string {
    const ymd = parseIso(today);
    if (!ymd) throw new Error('Дата должна быть в формате ГГГГ-ММ-ДД.');
    return toIso(fromUtc(new Date(Date.UTC(ymd.year, ymd.month + 1, 0))));
}

/** Подходящие даты вида `kind`, идущие после `anchor`, пока не пройден `horizon` (включительно). */
function* seriesDates(kind: string, anchor: Ymd, horizon: string): Generator<string> {
    for (let step = 1; ; step++) {
        let next: Ymd;
        if (kind === MONTHLY) next = addMonths(anchor, step);
        else if (kind === WEEKLY) next = addDays(anchor, 7 * step);
        else next = addDays(anchor, step);
        const iso = toIso(next);
        if (iso > horizon) return;
        if (kind === WEEKDAYS && isWeekend(next)) continue;
        yield iso;
    }
}

function repeatKind(task: DataObject): string {
    const value = task.properties.repeat;
    return typeof value === 'string' ? value : NONE;
}

function repeatIdOf(task: DataObject): string | undefined {
    const value = task.properties.repeatId;
    return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Все задачи дерева (текущие и архив). */
function allTasks(data: DataController): DataObject[] {
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

function datedMembers(data: DataController, members: DataObject[]) {
    return members
        .map((task) => ({ task, date: taskDate(data, task) }))
        .filter((m): m is { task: DataObject; date: string } => m.date !== undefined)
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Создаёт недостающие повторы набора: даты ряда от самой ранней задачи набора, позже самой
 * поздней из имеющихся, не раньше сегодня, до горизонта; уже занятые даты пропускаются.
 * Хуки не нужны: имя и порядок вычисляются здесь же.
 */
function fillSet(
    data: DataController,
    tx: ChangeScope,
    members: DataObject[],
    kind: string,
    today: string,
): void {
    const dated = datedMembers(data, members);
    if (dated.length === 0) return;
    const anchor = parseIso(dated[0].date);
    const template = dated[dated.length - 1];
    const last = template.date;
    const taken = new Set(dated.map((m) => m.date));
    if (!anchor) return;

    const properties: Record<string, unknown> = {};
    for (const key of COPIED) {
        const value = template.task.properties[key];
        if (value !== undefined && value !== null) properties[key] = value;
    }
    properties.repeat = kind;
    const draft = { ...template.task, properties };
    const name = taskName(draft);
    if (name !== undefined) properties.name = name;
    const order = taskOrder(draft);
    const chain = categoryChain(data, template.task);
    const rootId = findRoot(data, template.task, 'CurrentTasksRoot');

    for (const iso of seriesDates(kind, anchor, repeatHorizon(today))) {
        if (iso <= last || iso < today || taken.has(iso)) continue;
        const ymd = parseIso(iso)!;
        let container = ensureDay(data, tx, rootId, ymd);
        for (const category of chain) container = ensureCategory(data, tx, container, category);
        create(tx, container, TASK, { ...properties }, order);
        taken.add(iso);
    }
}

/**
 * Достраивает повторы всех наборов до горизонта (вызывается при каждом входе). Одним набором
 * изменений, без хуков; если достраивать нечего, на сервер ничего не уходит.
 */
export async function ensureRepeats(data: DataController): Promise<ChangeResult> {
    const sets = new Map<string, DataObject[]>();
    for (const task of allTasks(data)) {
        const id = repeatIdOf(task);
        if (!id || repeatKind(task) === NONE) continue;
        sets.set(id, [...(sets.get(id) ?? []), task]);
    }
    if (sets.size === 0) return { ok: true };

    const today = todayIso();
    return data.perform(
        (tx) => {
            for (const members of sets.values()) {
                const latest = datedMembers(data, members).at(-1);
                if (latest) fillSet(data, tx, members, repeatKind(latest.task), today);
            }
        },
        { hooks: false },
    );
}

function failed(result: { ok: boolean; error?: string }): HookResult {
    if (!result.ok) return { cancel: result.error ?? 'Не удалось обновить повторы.' };
}

/** Включение, смена и выключение повтора, синхронизация набора. Возвращает функцию отписки. */
export function registerRepeats(data: DataController): () => void {
    // Правки повторов внутри набора идут «тихо»: собственные хуки при этом не срабатывают,
    // иначе синхронизация зацикливалась бы.
    let silent = false;
    const quietly = <T>(run: () => T): T => {
        silent = true;
        try {
            return run();
        } finally {
            silent = false;
        }
    };

    const others = (task: DataObject, repeatId: string) =>
        allTasks(data).filter((t) => t.id !== task.id && repeatIdOf(t) === repeatId);

    function changeRepeat(task: DataObject, kind: string, tx: ChangeScope): HookResult {
        const current = repeatIdOf(task);
        const siblings = current ? others(task, current) : [];
        const date = taskDate(data, task);

        if (kind === NONE) {
            if (!current) return;
            for (const sibling of siblings) {
                const done = sibling.properties.status === COMPLETED;
                // Завершённые повторы — история: остаются, но отвязываются от набора.
                const result = done
                    ? tx.setProperty(sibling.id, 'repeatId', null)
                    : tx.remove(sibling.id);
                if (!result.ok) return failed(result);
                if (done) {
                    const kindReset = tx.setProperty(sibling.id, 'repeat', NONE);
                    if (!kindReset.ok) return failed(kindReset);
                }
            }
            return failed(tx.setProperty(task.id, 'repeatId', null));
        }

        const repeatId = current ?? uuid7();
        if (!current) {
            const result = tx.setProperty(task.id, 'repeatId', repeatId);
            if (!result.ok) return failed(result);
        }
        // Смена вида: более поздние несделанные повторы пересоздаются по новому правилу.
        for (const sibling of siblings) {
            const result =
                sibling.properties.status !== COMPLETED && date && taskDate(data, sibling)! > date
                    ? tx.remove(sibling.id)
                    : tx.setProperty(sibling.id, 'repeat', kind);
            if (!result.ok) return failed(result);
        }
        const members = [data.getObject(task.id)!, ...others(task, repeatId)];
        fillSet(data, tx, members, kind, todayIso());
    }

    function spread(
        task: DataObject,
        apply: (other: DataObject) => { ok: boolean; error?: string },
    ) {
        const repeatId = repeatIdOf(task);
        if (!repeatId) return;
        for (const other of others(task, repeatId)) {
            const result = apply(other);
            if (!result.ok) return failed(result);
        }
    }

    const disposers = [
        data.registerHook(TASK, 'setProperty', 'before', (ctx) => {
            if (silent || ctx.property !== 'repeat' || ctx.newValue !== WEEKDAYS) return;
            const iso = taskDate(data, ctx.object);
            const ymd = iso ? parseIso(iso) : null;
            if (ymd && isWeekend(ymd)) return { cancel: WEEKEND_MESSAGE };
        }),
        data.registerHook(TASK, 'setProperty', 'after', (ctx) => {
            if (silent || !ctx.property) return;
            const task = data.getObject(ctx.object.id);
            if (!task) return;
            const { property, newValue } = ctx;
            if (property === 'repeat') {
                const kind = typeof newValue === 'string' ? newValue : NONE;
                return quietly(() => changeRepeat(task, kind, ctx.tx));
            }
            if (!SYNCED.includes(property)) return;
            return quietly(() =>
                spread(task, (other) =>
                    (other.properties[property] ?? null) === (newValue ?? null)
                        ? { ok: true }
                        : ctx.tx.setProperty(other.id, property, newValue),
                ),
            );
        }),
        data.registerHook(TASK, 'move', 'after', (ctx) => {
            if (silent || !ctx.from || !ctx.to || ctx.from.order === ctx.to.order) return;
            const task = data.getObject(ctx.object.id);
            if (!task) return;
            return quietly(() =>
                spread(task, (other) =>
                    other.order === task.order
                        ? { ok: true }
                        : ctx.tx.move(other.id, { order: task.order }),
                ),
            );
        }),
    ];

    return () => disposers.forEach((dispose) => dispose());
}
