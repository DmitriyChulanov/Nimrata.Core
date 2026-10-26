import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataProvider, createDataController } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import manifest from './manifest.json';
import { NotificationsBinding } from './NotificationsBinding';
import { ensureStartStructure, registerTracker } from './tracker';

import type { TypeDefinition } from '@platform';
import type { BrowserNotifications } from './notifications';

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

async function setup(
    browser: BrowserNotifications | null,
    now = () => new Date(2026, 2, 4, 9, 0),
    userId?: string,
) {
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
            <NotificationsBinding browser={browser} now={now} userId={userId} />
        </DataProvider>,
    );
    return data;
}

/**
 * Уведомления Трекера в интерфейсе
 */
describe('Tracker: notifications in the interface', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());

    /**
     * Проверяет, что разрешение запрашивается только по кнопке и один раз
     */
    it('notificationsUi_permission_isNotRequestedAutomaticallyOnlyOnButtonOnce', async () => {
        const browser = fakeBrowser('default', 'granted');
        await setup(browser);
        expect(browser.requestPermission).not.toHaveBeenCalled();

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        await user.click(screen.getByRole('button', { name: 'Включить уведомления' }));

        expect(browser.requestPermission).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Включить уведомления' })).toBeNull();
    });

    /**
     * Проверяет, что после отказа кнопка пропадает и запрос не повторяется
     */
    it('notificationsUi_afterDenial_buttonDisappearsAndRequestIsNotRepeated', async () => {
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

    /**
     * Проверяет, что при принятом решении о разрешении кнопки нет
     */
    it('notificationsUi_permissionAlreadyDecided_hasNoButton', async () => {
        await setup(fakeBrowser('denied', 'denied'));
        expect(screen.queryByRole('button', { name: 'Включить уведомления' })).toBeNull();
    });

    /**
     * Проверяет, что без Notification API ничего не показывается и приложение не падает
     */
    it('notificationsUi_withoutNotificationApi_showsNothingAndDoesNotCrash', async () => {
        await setup(null);
        expect(screen.queryByRole('button')).toBeNull();
    });

    /**
     * Проверяет, что при выданном разрешении показывается уведомление о задаче
     */
    it('notificationsUi_permissionGranted_showsTaskNotification', async () => {
        const browser = fakeBrowser('granted', 'granted');
        await setup(browser);

        expect(browser.show).toHaveBeenCalledWith('09:00', 'Созвон');
    });

    /**
     * Проверяет, что показанное запоминается по пользователю и не дублируется после перемонтирования
     */
    it('notificationsUi_withUser_shownIsRememberedAndNotDuplicatedAfterRemount', async () => {
        localStorage.clear();
        const browser = fakeBrowser('granted', 'granted');
        const data = await setup(browser, undefined, 'u1');
        expect(browser.show).toHaveBeenCalledTimes(1);

        cleanup();
        render(
            <DataProvider controller={data}>
                <NotificationsBinding
                    browser={browser}
                    now={() => new Date(2026, 2, 4, 9, 5)}
                    userId="u1"
                />
            </DataProvider>,
        );

        expect(browser.show).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что без разрешения уведомления не показываются, а приложение работает
     */
    it('notificationsUi_withoutPermission_showsNothingAndAppWorks', async () => {
        const browser = fakeBrowser('denied', 'denied');
        await setup(browser);

        expect(browser.show).not.toHaveBeenCalled();
    });
});
