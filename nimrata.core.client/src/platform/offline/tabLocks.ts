/**
 * Блокировки вкладок (Web Locks): открытая вкладка держит свой lock, а очередь вкладки с
 * отпущенным lock (вкладка закрыта или перезагружена) подхватывает другая
 */

/**
 * Блокировки по имени
 */
export interface TabLocks {
    /** Берёт lock (ждёт, если он занят) и держит до вызова возвращённой функции */
    hold(name: string): Promise<() => void>;
    /**
     * Если lock свободен, берёт его на время `run` и возвращает `true`; занят — сразу `false`,
     * `run` не вызывается
     */
    ifAvailable(name: string, run: () => Promise<void>): Promise<boolean>;
}

/**
 * Минимум `LockManager`, который нужен блокировкам вкладок
 */
export interface LockManagerLike {
    request(name: string, callback: (lock: unknown) => Promise<unknown>): Promise<unknown>;
    request(
        name: string,
        options: { ifAvailable: boolean },
        callback: (lock: unknown) => Promise<unknown>,
    ): Promise<unknown>;
}

/**
 * Блокировки поверх Web Locks API
 *
 * @param manager - `LockManager` (по умолчанию `navigator.locks`)
 * @returns блокировки; `undefined`, если Web Locks недоступны
 */
export function createWebLocks(
    manager: LockManagerLike | undefined = (
        globalThis.navigator as { locks?: LockManagerLike } | undefined
    )?.locks,
): TabLocks | undefined {
    if (!manager) return undefined;
    return {
        hold(name) {
            return new Promise((held) => {
                void manager.request(
                    name,
                    () =>
                        new Promise<void>((release) => {
                            held(() => release());
                        }),
                );
            });
        },
        async ifAvailable(name, run) {
            const result = await manager.request(name, { ifAvailable: true }, async (lock) => {
                if (!lock) return false;
                await run();
                return true;
            });
            return result === true;
        },
    };
}

/**
 * Блокировки в памяти (одна «вкладка» — один вызов `hold`): для тестов и как запасной вариант
 * внутри одной страницы
 *
 * @returns блокировки, общие для всех, кто получил этот объект
 */
export function createMemoryLocks(): TabLocks {
    const held = new Set<string>();
    const waiters = new Map<string, (() => void)[]>();
    const release = (name: string) => {
        held.delete(name);
        const next = waiters.get(name)?.shift();
        next?.();
    };
    return {
        hold(name) {
            return new Promise((resolve) => {
                const grant = () => {
                    held.add(name);
                    let open = true;
                    resolve(() => {
                        if (!open) return;
                        open = false;
                        release(name);
                    });
                };
                if (!held.has(name)) grant();
                else waiters.set(name, [...(waiters.get(name) ?? []), grant]);
            });
        },
        async ifAvailable(name, run) {
            if (held.has(name)) return false;
            held.add(name);
            try {
                await run();
            } finally {
                release(name);
            }
            return true;
        },
    };
}
