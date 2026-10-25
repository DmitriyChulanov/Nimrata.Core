// Даты Трекера: разбор и форматирование `ГГГГ-ММ-ДД`, арифметика дней и месяцев, русские имена

export interface Ymd {
    year: number;
    month: number;
    day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });
const weekdayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', timeZone: 'UTC' });

export const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Разбирает `ГГГГ-ММ-ДД`; `null`, если формат неверен или такой даты нет в календаре */
export function parseIso(value: string): Ymd | null {
    const match = ISO_DATE.exec(value);
    if (!match) return null;
    const ymd = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    const check = toUtc(ymd);
    const valid =
        check.getUTCFullYear() === ymd.year &&
        check.getUTCMonth() === ymd.month - 1 &&
        check.getUTCDate() === ymd.day;
    return valid ? ymd : null;
}

/** Дата в виде `ГГГГ-ММ-ДД` */
export const toIso = ({ year, month, day }: Ymd) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/** Полночь по UTC для даты (даты Трекера не зависят от часового пояса) */
export function toUtc({ year, month, day }: Ymd): Date {
    return new Date(Date.UTC(year, month - 1, day));
}

export function fromUtc(date: Date): Ymd {
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Дата `now` по местному времени в виде `ГГГГ-ММ-ДД` (по умолчанию — сегодня) */
export function todayIso(now: Date = new Date()): string {
    return toIso({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

export function addDays(ymd: Ymd, days: number): Ymd {
    const date = toUtc(ymd);
    date.setUTCDate(date.getUTCDate() + days);
    return fromUtc(date);
}

/** Прибавляет месяцы; если в месяце нет такого числа, берётся его последний день */
export function addMonths(ymd: Ymd, months: number): Ymd {
    const index = ymd.year * 12 + ymd.month - 1 + months;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { year, month, day: Math.min(ymd.day, lastDay) };
}

/** Суббота или воскресенье */
export function isWeekend(ymd: Ymd): boolean {
    const weekday = toUtc(ymd).getUTCDay();
    return weekday === 0 || weekday === 6;
}

/** Имя месяца: «MMMM, yyyy» */
export function monthName(ymd: Ymd): string {
    return `${monthFormat.format(toUtc(ymd))}, ${ymd.year}`;
}

/** Имя дня: «dd.MM.yyyy, dddd» */
export function dayName(ymd: Ymd): string {
    return `${pad(ymd.day)}.${pad(ymd.month)}.${pad(ymd.year, 4)}, ${weekdayFormat.format(toUtc(ymd))}`;
}
