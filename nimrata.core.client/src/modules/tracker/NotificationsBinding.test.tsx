import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataProvider, createDataController } from '@platform';
import type { TypeDefinition } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { NotificationsBinding } from './NotificationsBinding';
import type { BrowserNotifications } from './notifications';
import { ensureStartStructure, registerTracker } from './tracker';

const types = manifest.types.map((t) => ({
    ...t,
    module: manifest.module,
    moduleVersion: manifest.version,
})) as TypeDefinition[];

function fakeBrowser(initial: NotificationPermission, answer: NotificationPermission) {
    let permission = initial;
    const browser: BrowserNotifications = {
        permission: () => permission,
        requestPermission: vi.fn(async () => {
            permission = answer;
            return answer;
        }),
        show: vi.fn(),
    };
    return browser;
}

async function setup(browser: BrowserNotifications | null, now = () => new Date(2026, 2, 4, 9, 0)) {
    const data = createDataController({ api: createFakeApi(types, []) });
    await data.load();
    registerTracker(data);
    await ensureStartStructure(data);
    const current = data
        .getChildren(null)
        .flatMap((o) => data.getChildren(o.id))
        .find((o) => o.type === 'CurrentTasksRoot')!;
    await data.runAction(current.id, 'createTask', { title: 'Созвон', date: '2026-03-04' });
    const task = data
        .getChildren(null)
        .flatMap((o) => data.getChildren(o.id))
        .flatMap((o) => data.getChildren(o.id))
        .flatMap((o) => data.getChildren(o.id))
        .flatMap((o) => data.getChildren(o.id))
        .find((o) => o.type === 'Task')!;
    await data.setProperty(task.id, 'time', '09:00');
    render(
        <DataProvider controller={data}>
            <NotificationsBinding browser={browser} now={now} />
        </DataProvider>,
    );
}

describe('Трекер: уведомления в интерфейсе', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());

    it('разрешение не запрашивается само: только по нажатию кнопки, один раз', async () => {
        const browser = fakeBrowser('default', 'granted');
        await setup(browser);
        expect(browser.requestPermission).not.toHaveBeenCalled();

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        await user.click(screen.getByRole('button', { name: 'Включить уведомления' }));

        expect(browser.requestPermission).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Включить уведомления' })).toBeNull();
    });

    it('после отказа кнопка пропадает и запрос не повторяется', async () => {
        const browser = fakeBrowser('default', 'denied');
        await setup(browser);

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        await user.click(screen.getByRole('button', { name: 'Включить уведомления' }));

        expect(screen.queryByRole('button', { name: 'Включить уведомления' })).toBeNull();
        act(() => {
            vi.advanceTimersByTime(120_000);
        });
        expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    });

    it('если решение уже принято, кнопки нет', async () => {
        await setup(fakeBrowser('denied', 'denied'));
        expect(screen.queryByRole('button', { name: 'Включить уведомления' })).toBeNull();
    });

    it('без поддержки Notification API ничего не показывает и не падает', async () => {
        await setup(null);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('при выданном разрешении показывает уведомление задачи', async () => {
        const browser = fakeBrowser('granted', 'granted');
        await setup(browser);

        expect(browser.show).toHaveBeenCalledWith('09:00', 'Созвон');
    });

    it('без разрешения уведомление не показывается, приложение работает', async () => {
        const browser = fakeBrowser('denied', 'denied');
        await setup(browser);

        expect(browser.show).not.toHaveBeenCalled();
    });
});
