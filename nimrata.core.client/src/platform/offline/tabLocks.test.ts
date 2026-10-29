import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebLocks } from './tabLocks';

import type { LockManagerLike } from './tabLocks';

/**
 * Поддельный `navigator.locks` с семантикой Web Locks: lock по имени у одного владельца, остальные
 * ждут по очереди; `ifAvailable` при занятом lock вызывает callback с `null`
 *
 * @returns менеджер и имена удерживаемых сейчас lock
 */
function fakeLockManager() {
    const held = new Set<string>();
    const waiters = new Map<string, (() => void)[]>();

    const acquire = async (name: string) => {
        if (!held.has(name)) {
            held.add(name);
            return;
        }
        await new Promise<void>((resolve) =>
            waiters.set(name, [...(waiters.get(name) ?? []), resolve]),
        );
    };
    const release = (name: string) => {
        const next = waiters.get(name)?.shift();
        if (next) next();
        else held.delete(name);
    };

    async function request(
        name: string,
        optionsOrCallback: { ifAvailable: boolean } | ((lock: unknown) => Promise<unknown>),
        maybeCallback?: (lock: unknown) => Promise<unknown>,
    ): Promise<unknown> {
        const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
        const callback =
            typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
        if (!callback) throw new Error('callback is required');
        if ('ifAvailable' in options && options.ifAvailable && held.has(name)) {
            return callback(null);
        }
        await acquire(name);
        try {
            return await callback({ name });
        } finally {
            release(name);
        }
    }

    const manager: LockManagerLike = { request };
    return { manager, held };
}

/**
 * Блокировки вкладок поверх Web Locks API
 */
describe('createWebLocks', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /**
     * Проверяет, что без Web Locks блокировок нет
     */
    it('createWebLocks_withoutLockManager_undefined', () => {
        vi.stubGlobal('navigator', {});

        expect(createWebLocks()).toBeUndefined();
    });

    /**
     * Проверяет, что по умолчанию используется `navigator.locks`
     */
    it('createWebLocks_default_usesNavigatorLocks', async () => {
        const { manager, held } = fakeLockManager();
        vi.stubGlobal('navigator', { locks: manager });
        const locks = createWebLocks();

        const release = await locks!.hold('tab:a');

        expect(held.has('tab:a')).toBe(true);
        release();
    });

    /**
     * Проверяет, что `hold` держит lock до вызова освобождения, а второй `hold` ждёт его
     */
    it('hold_heldUntilReleased_secondHolderWaits', async () => {
        const { manager, held } = fakeLockManager();
        const locks = createWebLocks(manager)!;
        const release = await locks.hold('tab:a');
        let second: (() => void) | null = null;
        const waiting = locks.hold('tab:a').then((r) => (second = r));
        await Promise.resolve();
        expect(second).toBeNull();

        release();
        await waiting;

        expect(second).not.toBeNull();
        expect(held.has('tab:a')).toBe(true);
        second!();
        await Promise.resolve();
        await Promise.resolve();
        expect(held.has('tab:a')).toBe(false);
    });

    /**
     * Проверяет, что `ifAvailable` при занятом lock сразу возвращает `false` и не вызывает `run`
     */
    it('ifAvailable_lockHeld_falseWithoutRun', async () => {
        const { manager } = fakeLockManager();
        const locks = createWebLocks(manager)!;
        const release = await locks.hold('tab:a');
        const run = vi.fn(() => Promise.resolve());

        expect(await locks.ifAvailable('tab:a', run)).toBe(false);

        expect(run).not.toHaveBeenCalled();
        release();
    });

    /**
     * Проверяет, что `ifAvailable` при свободном lock держит его на время `run` и отпускает после
     */
    it('ifAvailable_lockFree_heldDuringRunThenReleased', async () => {
        const { manager, held } = fakeLockManager();
        const locks = createWebLocks(manager)!;
        let heldDuringRun = false;

        const result = await locks.ifAvailable('tab:b', () => {
            heldDuringRun = held.has('tab:b');
            return Promise.resolve();
        });

        expect(result).toBe(true);
        expect(heldDuringRun).toBe(true);
        expect(held.has('tab:b')).toBe(false);
    });
});
