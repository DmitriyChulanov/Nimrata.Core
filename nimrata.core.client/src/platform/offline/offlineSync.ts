/**
 * Офлайн-часть контроллера данных: снимок подтверждённого состояния и очередь вкладки живут в
 * IndexedDB (база по пользователю), вкладка держит свой Web Lock, а очереди вкладок с отпущенным
 * lock (закрыта или перезагружена) подхватываются
 */
import { uuid7 } from '@platform/data/uuid7';

import { openOfflineDb } from './offlineDb';
import { createWebLocks } from './tabLocks';

import type { DataController } from '@platform/data/DataController';
import type { OfflineDb } from './offlineDb';
import type { TabLocks } from './tabLocks';

/**
 * Пауза перед сохранением после изменения: правки одной серии пишутся одной транзакцией
 */
export const OFFLINE_SAVE_DELAY_MS = 100;

/**
 * Как часто открытая вкладка ищет очереди закрытых вкладок
 */
export const OFFLINE_ADOPT_INTERVAL_MS = 10_000;

/**
 * Параметры офлайн-части
 */
export interface OfflineSyncOptions {
    /** Контроллер данных вкладки */
    controller: DataController;
    /** Вошедший пользователь: у каждого своя база */
    userId: string;
    /** Идентификатор вкладки (по умолчанию новый UUIDv7 на каждую загрузку страницы) */
    tabId?: string;
    /** Фабрика IndexedDB (по умолчанию глобальная) */
    indexedDB?: IDBFactory;
    /**
     * Блокировки вкладок (по умолчанию Web Locks). Без них очереди других вкладок подхватываются
     * только при старте: живая вкладка тогда может отправить тот же набор ещё раз, что безопасно —
     * сервер узнаёт повтор по `id`
     */
    locks?: TabLocks;
    /** Период поиска очередей закрытых вкладок */
    adoptIntervalMs?: number;
}

/**
 * Офлайн-часть вкладки
 */
export interface OfflineSync {
    /**
     * Старт: берёт lock вкладки; если есть кэш — модель сразу из него (`startFromCache`), затем
     * подхватывает очереди закрытых вкладок и начинает сохранять изменения. Догон — забота
     * вызывающего (`controller.catchUp`). Возвращает, нашёлся ли кэш (нет — нужна полная загрузка)
     */
    start(): Promise<boolean>;
    /** Сохраняет отложенное сейчас (снимок по правилу курсора и очередь вкладки) */
    flush(): Promise<void>;
    /** Неотправленные наборы: своя очередь и сохранённые очереди других вкладок, без повторов */
    unsentCount(): Promise<number>;
    /** Сохранённое значение базы (каталог расширений и т. п.); без базы — `undefined` */
    readValue(key: string): Promise<unknown>;
    /** Сохраняет значение в базу (без базы — ничего) */
    writeValue(key: string, value: unknown): Promise<void>;
    /** Освобождает: сохраняет очередь, отпускает lock, закрывает базу */
    dispose(): Promise<void>;
}

/**
 * Имя lock вкладки
 *
 * @param userId - пользователь
 * @param tabId - вкладка
 * @returns имя блокировки Web Locks
 */
function lockName(userId: string, tabId: string): string {
    return `nimrata-tab:${userId}:${tabId}`;
}

/**
 * Создаёт офлайн-часть вкладки
 *
 * @param options - контроллер, пользователь, вкладка, IndexedDB и блокировки
 * @returns офлайн-часть; работа начинается с `start`
 */
export function createOfflineSync(options: OfflineSyncOptions): OfflineSync {
    const { controller, userId } = options;
    const tabId = options.tabId ?? uuid7();
    const locks = options.locks ?? createWebLocks();
    const adoptIntervalMs = options.adoptIntervalMs ?? OFFLINE_ADOPT_INTERVAL_MS;

    let db: OfflineDb | null = null;
    let release: (() => void) | null = null;
    let disposed = false;
    // Курсор последнего сохранённого (или прочитанного) снимка; -1 — снимка нет
    let savedSeq = -1;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let adoptTimer: ReturnType<typeof setInterval> | null = null;
    let saving: Promise<void> = Promise.resolve();
    const stops: (() => void)[] = [];

    /**
     * Сохраняет снимок (если курсор сдвинулся и данные загружены) и очередь вкладки
     */
    const save = (): Promise<void> => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        const target = db;
        if (!target) return saving;
        const run = async () => {
            const sync = controller.sync;
            const ready = controller.getSnapshot().status === 'ready';
            const snapshot =
                ready && sync.getSeq() > savedSeq ? sync.confirmedSnapshot() : undefined;
            await target.save(tabId, { snapshot, queue: sync.pending() });
            if (snapshot) savedSeq = Math.max(savedSeq, snapshot.seq);
        };
        // Сохранения идут строго по очереди; сбой одного не мешает следующим
        saving = saving.then(run).catch(() => undefined);
        return saving;
    };

    const schedule = () => {
        if (disposed || saveTimer) return;
        saveTimer = setTimeout(() => void save(), OFFLINE_SAVE_DELAY_MS);
    };

    /**
     * Подхватывает очередь вкладки, если её lock отпущен (вкладка закрыта)
     *
     * @param target - открытая база
     * @param other - вкладка-владелец очереди
     */
    const adoptOne = async (target: OfflineDb, other: string) => {
        const take = async () => {
            if (disposed) return;
            const adopted = await target.adoptQueue(other, tabId);
            if (adopted.length > 0 && !disposed) controller.sync.restoreQueue(adopted);
        };
        if (locks) await locks.ifAvailable(lockName(userId, other), take);
        else await take();
    };

    /**
     * Ищет очереди других вкладок и подхватывает очереди закрытых
     */
    const adoptOrphans = async () => {
        const target = db;
        if (!target || disposed) return;
        try {
            const queues = await target.readQueues();
            for (const other of queues.keys()) {
                if (other !== tabId) await adoptOne(target, other);
            }
        } catch {
            // база закрыта или удалена (выход в другой вкладке): попробуем в следующий раз
        }
    };

    const onPageHide = () => void save();

    return {
        async start() {
            // Освобождение во время старта: старт сам закрывает то, что успел открыть
            const abandon = () => {
                db?.close();
                db = null;
                release?.();
                release = null;
                return false;
            };
            if (locks) release = await locks.hold(lockName(userId, tabId));
            if (disposed) return abandon();
            db = await openOfflineDb(userId, { indexedDB: options.indexedDB });
            if (disposed) return abandon();
            const cached = await db.readSnapshot();
            if (disposed) return abandon();
            if (cached) {
                savedSeq = cached.seq;
                controller.startFromCache(cached);
            }
            await adoptOrphans();
            stops.push(controller.subscribe(schedule), controller.sync.subscribePending(schedule));
            if (locks) adoptTimer = setInterval(() => void adoptOrphans(), adoptIntervalMs);
            globalThis.addEventListener?.('pagehide', onPageHide);
            return cached !== undefined;
        },
        flush: save,
        async unsentCount() {
            const ids = new Set(controller.sync.pending().map((c) => c.id));
            try {
                const queues = (await db?.readQueues()) ?? new Map();
                for (const changesets of queues.values()) for (const c of changesets) ids.add(c.id);
            } catch {
                // база недоступна: считаем только свою очередь
            }
            return ids.size;
        },
        async readValue(key) {
            try {
                return await db?.readValue(key);
            } catch {
                return undefined;
            }
        },
        async writeValue(key, value) {
            try {
                await db?.writeValue(key, value);
            } catch {
                // кэш — не главное: без него просто не будет старта без сети
            }
        },
        async dispose() {
            if (disposed) return;
            disposed = true;
            stops.forEach((stop) => stop());
            if (adoptTimer) clearInterval(adoptTimer);
            globalThis.removeEventListener?.('pagehide', onPageHide);
            await save();
            db?.close();
            db = null;
            release?.();
            release = null;
        },
    };
}
