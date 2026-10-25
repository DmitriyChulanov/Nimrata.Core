import type { DataController, DataObject } from '@platform';

import { TASK, taskDate } from './tasks';

/** Период проверки задач. */
export const CHECK_INTERVAL_MS = 60_000;
/** Сколько минут после назначенного времени уведомление ещё уместно (при входе позже — пропускается). */
export const GRACE_MINUTES = 60;

const TIME = /^(\d{2}):(\d{2})$/;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Уведомление, которое пора показать. */
export interface DueNotification {
    taskId: string;
    /** Время задачи «HH:mm». */
    title: string;
    /** Название задачи. */
    body: string;
}

/** Состояние службы: сутки (`ГГГГ-ММ-ДД`) и задачи, по которым уведомление уже показано. */
export interface NotificationState {
    date: string;
    shown: ReadonlySet<string>;
}

export function createNotificationState(): NotificationState {
    return { date: '', shown: new Set() };
}

/** Дата в местном времени: `ГГГГ-ММ-ДД`. */
function isoDate(now: Date): string {
    return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Время задачи в минутах от полуночи; `undefined`, если времени нет. */
function minutesOfDay(task: DataObject): number | undefined {
    const time = task.properties.time;
    const match = typeof time === 'string' ? TIME.exec(time) : null;
    return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function notifyBefore(task: DataObject): number {
    const value = task.properties.notifyBefore;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

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

/**
 * Чистый расчёт: какие уведомления пора показать в момент `now`. Берёт задачи сегодняшнего дня
 * с временем, не завершённые; момент уведомления — «время минус N минут». Уже показанные
 * (в пределах суток) пропускаются; при смене суток список показанных начинается заново.
 */
export function checkNotifications(
    data: DataController,
    now: Date,
    state: NotificationState,
): { due: DueNotification[]; state: NotificationState } {
    const today = isoDate(now);
    const shown = new Set(state.date === today ? state.shown : []);
    const current = now.getHours() * 60 + now.getMinutes();
    const due: DueNotification[] = [];

    for (const task of allTasks(data)) {
        if (shown.has(task.id) || task.properties.status === 'completed') continue;
        const time = minutesOfDay(task);
        if (time === undefined || taskDate(data, task) !== today) continue;
        const moment = time - notifyBefore(task);
        if (current < moment || current >= time + GRACE_MINUTES) continue;
        shown.add(task.id);
        due.push({
            taskId: task.id,
            title: `${pad(Math.floor(time / 60))}:${pad(time % 60)}`,
            body: typeof task.properties.title === 'string' ? task.properties.title : '',
        });
    }
    return { due, state: { date: today, shown } };
}

export interface NotificationServiceOptions {
    data: DataController;
    /** Показывает уведомление; по умолчанию — `Notification` браузера, если разрешение выдано. */
    notify?: (title: string, body: string) => void;
    /** Часы; подменяются в тестах. */
    now?: () => Date;
}

/** Узкий слой над Notification API браузера (подменяется в тестах). */
export interface BrowserNotifications {
    permission(): NotificationPermission;
    requestPermission(): Promise<NotificationPermission>;
    show(title: string, body: string): void;
}

/** Notification API текущего браузера; `null`, если он не поддерживается. */
export function browserNotifications(): BrowserNotifications | null {
    if (typeof Notification === 'undefined') return null;
    return {
        permission: () => Notification.permission,
        requestPermission: () => Notification.requestPermission(),
        show: (title, body) => {
            new Notification(title, { body });
        },
    };
}

/** Показывает уведомление, только если разрешение выдано. */
export function showBrowserNotification(title: string, body: string): void {
    const browser = browserNotifications();
    if (browser?.permission() === 'granted') browser.show(title, body);
}

/**
 * Проверяет задачи сразу и затем раз в минуту, пока вкладка открыта.
 * Возвращает функцию остановки.
 */
export function startNotificationService({
    data,
    notify = showBrowserNotification,
    now = () => new Date(),
}: NotificationServiceOptions): () => void {
    let state = createNotificationState();
    const tick = () => {
        const result = checkNotifications(data, now(), state);
        state = result.state;
        for (const item of result.due) notify(item.title, item.body);
    };
    tick();
    const timer = setInterval(tick, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
}
