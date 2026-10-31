/**
 * Тонкая обёртка над IndexedDB для работы без сети: у каждого пользователя своя база со снимком
 * подтверждённого состояния (объекты, типы, курсор), очередями неподтверждённых наборов по вкладкам
 * (`tabId`) и произвольными значениями (каталог расширений)
 */
import { isPendingChangeset, isRecord, isStoreSnapshot } from '@platform/data/dataGuards';

import type { PendingChangeset, StoreSnapshot } from '@platform/data/dataStore';

/**
 * Версия схемы базы
 */
const DB_VERSION = 1;

/**
 * Хранилище значений по ключу: снимок и прочее
 */
const META = 'meta';

/**
 * Хранилище очередей вкладок: ключ — `tabId`
 */
const QUEUES = 'queues';

/**
 * Ключ снимка в `meta`
 */
const SNAPSHOT_KEY = 'snapshot';

/**
 * Запись очереди вкладки
 */
interface QueueRecord {
    /** Вкладка-владелец */
    tabId: string;
    /** Неподтверждённые наборы в порядке очереди */
    changesets: PendingChangeset[];
}

/**
 * Проверяет, что значение из IndexedDB — запись очереди вкладки (база могла остаться от старой
 * версии клиента или быть испорчена)
 *
 * @param value - прочитанное значение
 * @returns `true`, если есть `tabId` и массив наборов верной формы
 */
function isQueueRecord(value: unknown): value is QueueRecord {
    return (
        isRecord(value) &&
        typeof value.tabId === 'string' &&
        Array.isArray(value.changesets) &&
        value.changesets.every(isPendingChangeset)
    );
}

/**
 * Снимок из IndexedDB: значение неверной формы считается отсутствующим (кэша нет)
 *
 * @param value - прочитанное значение
 * @returns снимок или `undefined`
 */
function snapshotOf(value: unknown): StoreSnapshot | undefined {
    return isStoreSnapshot(value) ? value : undefined;
}

/**
 * Что сохранить за один раз
 */
export interface OfflineState {
    /** Снимок подтверждённого состояния; пишется, только если его курсор больше сохранённого */
    snapshot?: StoreSnapshot;
    /** Очередь вкладки целиком; пустая убирает запись вкладки */
    queue: readonly PendingChangeset[];
}

/**
 * Открытая база пользователя
 */
export interface OfflineDb {
    /** Сохранённый снимок; `undefined` — кэша нет */
    readSnapshot(): Promise<StoreSnapshot | undefined>;
    /** Сохраняет снимок (по правилу курсора) и очередь вкладки одной транзакцией */
    save(tabId: string, state: OfflineState): Promise<void>;
    /** Очереди всех вкладок */
    readQueues(): Promise<Map<string, PendingChangeset[]>>;
    /**
     * Подхватывает очередь вкладки `fromTabId`: её запись удаляется, наборы дописываются в конец
     * очереди `toTabId` — одной транзакцией. Возвращает подхваченные наборы (нет записи — пусто)
     */
    adoptQueue(fromTabId: string, toTabId: string): Promise<PendingChangeset[]>;
    /** Произвольное сохранённое значение; `undefined` — нет */
    readValue(key: string): Promise<unknown>;
    /** Сохраняет произвольное значение */
    writeValue(key: string, value: unknown): Promise<void>;
    /** Закрывает соединение */
    close(): void;
}

/**
 * Параметры доступа к IndexedDB
 */
export interface OfflineDbOptions {
    /** Фабрика IndexedDB (по умолчанию глобальная; в тестах — `fake-indexeddb`) */
    indexedDB?: IDBFactory;
}

/**
 * Имя базы пользователя
 *
 * @param userId - идентификатор пользователя
 * @returns имя базы IndexedDB
 */
export function offlineDbName(userId: string): string {
    return `nimrata:${userId}`;
}

/**
 * Промис из запроса IndexedDB
 *
 * @template T - результат запроса
 * @param request - запрос
 * @returns результат или отказ с ошибкой запроса
 */
function done<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Ошибка IndexedDB.'));
    });
}

/**
 * Промис завершения транзакции
 *
 * @param tx - транзакция
 * @returns разрешается по `complete`, отказ — по ошибке или прерыванию
 */
function committed(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Ошибка IndexedDB.'));
        tx.onabort = () => reject(tx.error ?? new Error('Транзакция IndexedDB прервана.'));
    });
}

/**
 * Фабрика IndexedDB из параметров или глобальная
 *
 * @param options - параметры доступа
 * @returns фабрика; без неё — исключение
 */
function factoryOf(options: OfflineDbOptions): IDBFactory {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB недоступна.');
    return factory;
}

/**
 * Открывает (и при необходимости создаёт) базу пользователя
 *
 * @param userId - идентификатор пользователя
 * @param options - фабрика IndexedDB
 * @returns открытая база
 */
export async function openOfflineDb(
    userId: string,
    options: OfflineDbOptions = {},
): Promise<OfflineDb> {
    const request = factoryOf(options).open(offlineDbName(userId), DB_VERSION);
    request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        if (!db.objectStoreNames.contains(QUEUES))
            db.createObjectStore(QUEUES, { keyPath: 'tabId' });
    };
    const db = await done(request);
    // Удаление базы (выход в другой вкладке) не должно ждать этого соединения
    db.onversionchange = () => db.close();

    return {
        async readSnapshot() {
            const tx = db.transaction(META, 'readonly');
            return snapshotOf(await done<unknown>(tx.objectStore(META).get(SNAPSHOT_KEY)));
        },
        async save(tabId, state) {
            const tx = db.transaction([META, QUEUES], 'readwrite');
            const finished = committed(tx);
            const meta = tx.objectStore(META);
            if (state.snapshot) {
                const next = state.snapshot;
                const read = meta.get(SNAPSHOT_KEY);
                read.onsuccess = () => {
                    const saved = snapshotOf(read.result);
                    if (!saved || next.seq > saved.seq) meta.put(next, SNAPSHOT_KEY);
                };
            }
            const queues = tx.objectStore(QUEUES);
            if (state.queue.length > 0) {
                const record: QueueRecord = { tabId, changesets: [...state.queue] };
                queues.put(record);
            } else {
                queues.delete(tabId);
            }
            await finished;
        },
        async readQueues() {
            const tx = db.transaction(QUEUES, 'readonly');
            // Испорченные записи пропускаются: их наборы отправить всё равно нельзя
            const records = (await done<unknown[]>(tx.objectStore(QUEUES).getAll())).filter(
                isQueueRecord,
            );
            return new Map(records.map((r) => [r.tabId, r.changesets]));
        },
        async adoptQueue(fromTabId, toTabId) {
            const tx = db.transaction(QUEUES, 'readwrite');
            const finished = committed(tx);
            const queues = tx.objectStore(QUEUES);
            let adopted: PendingChangeset[] = [];
            const from = queues.get(fromTabId);
            from.onsuccess = () => {
                const record: unknown = from.result;
                if (!isQueueRecord(record)) {
                    // Испорченную запись закрытой вкладки убираем: подхватить из неё нечего
                    if (record !== undefined) queues.delete(fromTabId);
                    return;
                }
                adopted = record.changesets;
                queues.delete(fromTabId);
                const to = queues.get(toTabId);
                to.onsuccess = () => {
                    const target: unknown = to.result;
                    const own = isQueueRecord(target) ? target.changesets : [];
                    const known = new Set(own.map((c) => c.id));
                    const merged = [...own, ...adopted.filter((c) => !known.has(c.id))];
                    queues.put({ tabId: toTabId, changesets: merged } satisfies QueueRecord);
                };
            };
            await finished;
            return adopted;
        },
        async readValue(key) {
            const tx = db.transaction(META, 'readonly');
            return done(tx.objectStore(META).get(key));
        },
        async writeValue(key, value) {
            const tx = db.transaction(META, 'readwrite');
            const finished = committed(tx);
            tx.objectStore(META).put(value, key);
            await finished;
        },
        close: () => db.close(),
    };
}

/**
 * Удаляет базу пользователя (выход). Открытые соединения других вкладок закрываются сами
 * (`versionchange`), поэтому удаление не блокируется
 *
 * @param userId - идентификатор пользователя
 * @param options - фабрика IndexedDB
 * @returns разрешается после удаления
 */
export async function deleteOfflineDb(
    userId: string,
    options: OfflineDbOptions = {},
): Promise<void> {
    await done(factoryOf(options).deleteDatabase(offlineDbName(userId)));
}
