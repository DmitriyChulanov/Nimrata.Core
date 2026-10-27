import { CREATE_SCHEDULE_COMMAND, CURRENT_TASKS_ROOT, DAY_TYPES } from './constants';
import { addDays, parseIso, todayIso, toUtc } from './dates';
import { ensureDay, findRoot } from './nodes';
import { repeatHorizon, topUpRepeats } from './repeats';

import type { ChangeScope, DataController, DataObject } from '@platform';
import type { Ymd } from './dates';

/**
 * Наибольшее число дней между началом и концом периода расписания
 */
const MAX_PERIOD_DAYS = 365;

/**
 * Миллисекунд в сутках
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Разбирает параметр-дату команды; пустое значение заменяется значением по умолчанию
 */
function dateParam(value: unknown, fallback: string, name: string): Ymd {
    const iso = typeof value === 'string' && value !== '' ? value : fallback;
    const ymd = parseIso(iso);
    if (!ymd) throw new Error(`Параметр «${name}»: дата должна быть в формате ГГГГ-ММ-ДД.`);
    return ymd;
}

/**
 * Последний день года, в котором лежит `today`
 */
function endOfYear(today: string): string {
    return `${today.slice(0, 4)}-12-31`;
}

/**
 * Дата самого позднего дня внутри «Текущих задач» (`ГГГГ-ММ-ДД`); `undefined`, если дней нет
 */
function lastDayDate(data: DataController, root: DataObject): string | undefined {
    let last: string | undefined;
    const walk = (parent: string) => {
        for (const child of data.getChildren(parent)) {
            if (!DAY_TYPES.includes(child.type)) {
                walk(child.id);
                continue;
            }
            const date = child.properties.date;
            if (typeof date === 'string' && (last === undefined || date > last)) last = date;
        }
    };
    walk(root.id);
    return last;
}

/**
 * Создаёт расписание: месяцы и дни периода внутри «Текущих задач» (суббота и воскресенье — выходные
 * дни, существующие не дублируются) и достраивает повторы на весь период. Всё идёт в `tx`.
 * Горизонт повторов — наибольшее из конца следующего месяца и последнего существующего дня
 *
 * @param data - контроллер данных
 * @param tx - набор изменений команды
 * @param params - параметры `start` (по умолчанию сегодня) и `end` (по умолчанию конец года)
 * @throws Error при неверных датах, начале позже конца, периоде больше 365 дней или отсутствии корня
 */
export function createSchedule(
    data: DataController,
    tx: ChangeScope,
    params: Record<string, unknown>,
): void {
    const today = todayIso();
    const start = dateParam(params.start, today, 'Начало');
    const end = dateParam(params.end, endOfYear(today), 'Конец');
    const span = Math.round((toUtc(end).getTime() - toUtc(start).getTime()) / DAY_MS);
    if (span < 0) throw new Error('Начало не может быть позже конца.');
    if (span > MAX_PERIOD_DAYS) {
        throw new Error(`Период не может быть больше ${MAX_PERIOD_DAYS} дней.`);
    }
    const root = findRoot(data, CURRENT_TASKS_ROOT);
    if (!root) throw new Error('Не найдена группа «Текущие задачи».');

    for (let offset = 0; offset <= span; offset++) {
        ensureDay(data, tx, root.id, addDays(start, offset));
    }

    const horizon = [repeatHorizon(today), lastDayDate(data, root)]
        .filter((d): d is string => d !== undefined)
        .reduce((a, b) => (a > b ? a : b));
    topUpRepeats(data, tx, today, horizon);
}

/**
 * Подключает команду «Создать расписание». Возвращает функцию отписки
 */
export function registerCreateSchedule(data: DataController): () => void {
    return data.registerCommand(CREATE_SCHEDULE_COMMAND, ({ params, tx }) =>
        createSchedule(data, tx, params),
    );
}
