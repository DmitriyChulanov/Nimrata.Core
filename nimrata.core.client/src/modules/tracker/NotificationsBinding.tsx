import { useEffect, useMemo, useState } from 'react';

import { useData } from '@platform';

import {
    browserNotifications,
    createLocalShownStore,
    startNotificationService,
} from './notifications';

import type { BrowserNotifications } from './notifications';

/**
 * Свойства компонента `NotificationsBinding`
 */
export interface NotificationsBindingProps {
    /** Notification API; `null` — не поддерживается. По умолчанию берётся из браузера */
    browser?: BrowserNotifications | null;
    /** Часы; подменяются в тестах */
    now?: () => Date;
    /** Пользователь: показанные за день уведомления запоминаются по нему и переживают перезагрузку */
    userId?: string;
}

/**
 * Запускает службу уведомлений, пока компонент смонтирован (вкладка открыта).
 * Пока решение о разрешении не принято, показывает кнопку: запрос идёт только по её нажатию
 * и один раз — после ответа (в том числе отказа) кнопка пропадает
 */
export function NotificationsBinding({ browser, now, userId }: NotificationsBindingProps) {
    const data = useData();
    const api = useMemo(
        () => (browser === undefined ? browserNotifications() : browser),
        [browser],
    );
    const store = useMemo(() => (userId ? createLocalShownStore(userId) : undefined), [userId]);
    const [permission, setPermission] = useState(() => api?.permission());

    useEffect(() => {
        if (!api) return;
        return startNotificationService({
            data,
            now,
            store,
            notify: (title, body) => {
                if (api.permission() === 'granted') api.show(title, body);
            },
        });
    }, [api, data, now, store]);

    if (!api || permission !== 'default') return null;

    return (
        <button
            type="button"
            onClick={() => {
                void api.requestPermission().then(
                    (result) => setPermission(result),
                    () => setPermission('denied'),
                );
            }}
        >
            Включить уведомления
        </button>
    );
}
