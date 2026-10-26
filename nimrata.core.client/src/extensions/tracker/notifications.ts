import { COMPLETED } from './constants';
import { pad, todayIso } from './dates';
import { allTasks, taskDate } from './tasks';

import type { DataController, DataObject } from '@platform';

/**
 * Период проверки задач
 */
export const CHECK_INTERVAL_MS = 60_000;
/**
 * Сколько минут после назначенного времени уведомление ещё уместно (при входе позже — пропускается)
 */
export const GRACE_MINUTES = 60;

/**
 * Формат времени задачи `ЧЧ:мм`
 */
const TIME = /^(\d{2}):(\d{2})$/;

/**
 * Уведомление, которое пора показать
 */
export interface DueNotification {
    /** Идентификатор задачи */
    taskId: string;
    /** Время задачи «HH:mm» */
    title: string;
    /** Название задачи */
    body: string;
}

/**
 * Состояние службы: сутки (`ГГГГ-ММ-ДД`) и задачи, по которым уведомление уже показано
 */
export interface NotificationState {
    date: string;
    shown: ReadonlySet<string>;
}

/**
 * Создаёт пустое состояние службы уведомлений
 *
 * @returns состояние без показанных уведомлений
 */
export function createNotificationState(): NotificationState {
    return { date: '', shown: new Set() };
}

/**
 * Время задачи в минутах от полуночи; `undefined`, если времени нет
 */
function minutesOfDay(task: DataObject): number | undefined {
    const time = task.properties.time;
    const match = typeof time === 'string' ? TIME.exec(time) : null;
    return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

/**
 * За сколько минут до времени задачи нужно уведомить
 *
 * @param task - задача
 * @returns число минут; 0, если уведомление за время не настроено
 */
function notifyBefore(task: DataObject): number {
    const value = task.properties.notifyBefore;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Чистый расчёт: какие уведомления пора показать в момент `now`. Берёт задачи сегодняшнего дня
 * с временем, не завершённые; момент уведомления — «время минус N минут». Уже показанные
 * (в пределах суток) пропускаются; при смене суток список показанных начинается заново
 */
export function checkNotifications(
    data: DataController,
    now: Date,
    state: NotificationState,
): { due: DueNotification[]; state: NotificationState } {
    const today = todayIso(now);
    const shown = new Set(state.date === today ? state.shown : []);
    const current = now.getHours() * 60 + now.getMinutes();
    const due: DueNotification[] = [];

    for (const task of allTasks(data)) {
        if (shown.has(task.id) || task.properties.status === COMPLETED) continue;
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

/**
 * Параметры службы уведомлений
 */
export interface NotificationServiceOptions {
    /** Контроллер данных, из которого берутся задачи */
    data: DataController;
    /** Показывает уведомление; по умолчанию — `Notification` браузера, если разрешение выдано */
    notify?: (title: string, body: string) => void;
    /** Часы; подменяются в тестах */
    now?: () => Date;
    /** Хранилище показанных на день; без него память живёт только до перезагрузки страницы */
    store?: ShownStore;
}

/**
 * Где запоминаются задачи, по которым уведомление за день уже показано
 */
export interface ShownStore {
    /** Показанные в сутки `date` (`ГГГГ-ММ-ДД`); записи прошлых дней могут быть удалены */
    load(date: string): ReadonlySet<string>;
    /** Запоминает показанные за сутки `date` */
    save(date: string, shown: ReadonlySet<string>): void;
}

/**
 * Префикс ключей `localStorage` для показанных уведомлений
 */
const STORE_PREFIX = 'nimrata.tracker.notifications.';

/**
 * Хранилище в `localStorage`: ключ — пользователь и дата. Любая ошибка хранилища (недоступно,
 * переполнено, мусор в значении) молча даёт пустой набор: уведомления просто могут повториться
 */
export function createLocalShownStore(userId: string): ShownStore {
    const prefix = `${STORE_PREFIX}${userId}.`;
    return {
        load(date) {
            try {
                const parsed: unknown = JSON.parse(localStorage.getItem(prefix + date) ?? '[]');
                return new Set(
                    Array.isArray(parsed)
                        ? parsed.filter((id): id is string => typeof id === 'string')
                        : [],
                );
            } catch {
                return new Set();
            }
        },
        save(date, shown) {
            try {
                localStorage.setItem(prefix + date, JSON.stringify([...shown]));
                // Записи прошлых дней этого пользователя больше не нужны
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const key = localStorage.key(i);
                    if (key?.startsWith(prefix) && key !== prefix + date)
                        localStorage.removeItem(key);
                }
            } catch {
                // хранилище недоступно: уведомления после перезагрузки могут повториться
            }
        },
    };
}

/**
 * Узкий слой над Notification API браузера (подменяется в тестах)
 */
export interface BrowserNotifications {
    permission(): NotificationPermission;
    requestPermission(): Promise<NotificationPermission>;
    show(title: string, body: string): void;
}

/**
 * Notification API текущего браузера; `null`, если он не поддерживается
 */
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

/**
 * Показывает уведомление, только если разрешение выдано
 */
export function showBrowserNotification(title: string, body: string): void {
    const browser = browserNotifications();
    if (browser?.permission() === 'granted') browser.show(title, body);
}

/**
 * Проверяет задачи сразу и затем раз в минуту, пока вкладка открыта.
 * Возвращает функцию остановки
 */
export function startNotificationService({
    data,
    notify = showBrowserNotification,
    now = () => new Date(),
    store,
}: NotificationServiceOptions): () => void {
    let state = createNotificationState();
    const tick = () => {
        const moment = now();
        const today = todayIso(moment);
        // Новые сутки (или первый запуск): показанное восстанавливается из хранилища
        if (store && state.date !== today) state = { date: today, shown: store.load(today) };
        const result = checkNotifications(data, moment, state);
        state = result.state;
        if (store && result.due.length > 0) store.save(today, state.shown);
        for (const item of result.due) notify(item.title, item.body);
    };
    tick();
    const timer = setInterval(tick, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
}
