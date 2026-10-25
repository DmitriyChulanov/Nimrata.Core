import { useEffect, useMemo, useState } from 'react';

import { useData } from '@platform';

import { browserNotifications, startNotificationService } from './notifications';
import type { BrowserNotifications } from './notifications';

export interface NotificationsBindingProps {
    /** Notification API; `null` — не поддерживается. По умолчанию берётся из браузера. */
    browser?: BrowserNotifications | null;
    /** Часы; подменяются в тестах. */
    now?: () => Date;
}

/**
 * Запускает службу уведомлений, пока компонент смонтирован (вкладка открыта).
 * Пока решение о разрешении не принято, показывает кнопку: запрос идёт только по её нажатию
 * и один раз — после ответа (в том числе отказа) кнопка пропадает.
 */
export function NotificationsBinding({ browser, now }: NotificationsBindingProps) {
    const data = useData();
    const api = useMemo(
        () => (browser === undefined ? browserNotifications() : browser),
        [browser],
    );
    const [permission, setPermission] = useState(() => api?.permission());

    useEffect(() => {
        if (!api) return;
        return startNotificationService({
            data,
            now,
            notify: (title, body) => {
                if (api.permission() === 'granted') api.show(title, body);
            },
        });
    }, [api, data, now]);

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
