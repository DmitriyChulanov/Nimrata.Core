import { ApiError } from '@platform/api/apiClient';

import { checkChangeset } from './changesetRules';
import { applyOperations } from './undoHistory';

import type { ApiClient } from '@platform/api/apiClient';
import type { RuleObject, RuleType } from './changesetRules';
import type { ChangesetResult, DataController, DataObject } from './DataController';
import type { Operation } from './undoHistory';

/**
 * Расширение каталога подставного API (`GET /extensions`); пропущенные поля заполняются
 */
export interface FakeExtension {
    id: string;
    name?: string;
    description?: string;
    icon?: string;
    defaultEnabled?: boolean;
    /** Команды расширения из манифеста */
    commands?: unknown[];
    /** Подключено ли расширение у пользователя */
    connected: boolean;
}

/**
 * Параметры подставного API
 */
export interface FakeApiOptions {
    /**
     * Каталог расширений. Если задан, API ведёт себя как сервер: отдаёт `GET /extensions`,
     * принимает `PUT /extensions/{id}/connection`, скрывает объекты отключённых расширений и
     * сохраняет принятые наборы (следующий `GET /objects` их видит)
     */
    extensions?: FakeExtension[];
}

/**
 * Поддельный API-клиент в памяти для тестов `DataController`: отдаёт типы, объекты, снимок
 * (`GET /snapshot`) и догон (`GET /changes?since=N`), записывает наборы изменений
 */
export interface FakeApi extends ApiClient {
    types: unknown[];
    objects: unknown[];
    /** Все применённые наборы изменений (наборы из тел пакетных запросов) */
    changesets: { id: string; operations: Record<string, unknown>[] }[];
    /** Каталог расширений с текущим состоянием подключений */
    extensions: Required<FakeExtension>[];
    /**
     * Следующий запрос записи завершится отказом. `422` — следующий набор пакета получит итог
     * `rejected` с этой причиной и кодом (`code`), как отказ сервера по инварианту; любой другой
     * код — весь запрос завершится `ApiError` с этим HTTP-кодом (сеть, авторизация, формат)
     */
    rejectNext(status: number, message: string, code?: string): void;
}

/**
 * Платформенные типы без расширения (как в миграциях сервера `0023`, `0024`), которые есть у каждого пользователя
 */
const PLATFORM_TYPES: ({ id: string } & Record<string, unknown>)[] = [
    {
        id: 'SettingsRoot',
        name: 'Настройки',
        sealed: true,
        singleton: true,
        icon: 'settings',
        iconColor: 'gray',
    },
    {
        id: 'CustomCommand',
        name: 'Пользовательская команда',
        sealed: true,
        hiddenInTree: true,
        allowedChildren: [],
        properties: [
            { id: 'name', name: 'Имя', kind: 'string', category: 'Основное' },
            {
                id: 'extension',
                name: 'Расширение',
                kind: 'string',
                category: 'Основное',
                readOnly: true,
            },
            {
                id: 'command',
                name: 'Команда',
                kind: 'string',
                category: 'Основное',
                readOnly: true,
            },
            {
                id: 'params',
                name: 'Параметры',
                kind: 'text',
                hidden: true,
                readOnly: true,
            },
        ],
        icon: 'play',
        iconColor: 'gray',
    },
];

/**
 * Добавляет к типам теста платформенные типы, которых среди них нет
 *
 * @param types - типы теста
 * @returns типы вместе с платформенными
 */
function withPlatformTypes(types: unknown[]): unknown[] {
    const known = new Set((types as RuleType[]).map((t) => t.id));
    return [...types, ...PLATFORM_TYPES.filter((t) => !known.has(t.id))];
}

let postedChangesets = 0;

/**
 * Отправляет операции одним набором пакетной записи (`POST changesets`) и возвращает его итог
 *
 * @param api - API-клиент (подставной или настоящий)
 * @param operations - операции набора
 * @param id - идентификатор набора; по умолчанию новый на каждый вызов
 * @returns итог набора: `applied`, `duplicate` или `rejected`
 */
export async function postChangeset(
    api: ApiClient,
    operations: readonly unknown[],
    id = `00000000-0000-7000-8000-${String(++postedChangesets).padStart(12, '0')}`,
): Promise<ChangesetResult> {
    const [result] = await api.post<ChangesetResult[]>('changesets', {
        changesets: [{ id, operations }],
    });
    if (!result) throw new Error('Сервер не вернул итог набора.');
    return result;
}

/**
 * Набор из тела пакетной записи `POST /changesets`
 */
interface SubmittedChangeset {
    /** Идентификатор набора */
    id: string;
    /** Операции набора */
    operations: Record<string, unknown>[];
}

/**
 * Итог отклонённого набора
 *
 * @param id - идентификатор набора
 * @param error - причина отказа
 * @param code - машинный код отказа
 * @returns итог `rejected`
 */
function rejectedResult(id: string, error: string, code?: string): ChangesetResult {
    const result: ChangesetResult = { id, status: 'rejected', detail: error };
    if (code) result.code = code;
    return result;
}

/**
 * Применённый подставным API набор: курсор и затронутые объекты (для `GET /changes`)
 */
interface AppliedChangeset {
    /** Идентификатор набора */
    id: string;
    /** Курсор набора */
    seq: number;
    /** Идентификаторы затронутых объектов */
    touched: string[];
}

/**
 * Ждёт, пока очередь неподтверждённых наборов опустеет: итоги действий локальные, а тестам,
 * которые смотрят на отправленное (`api.changesets`) или отказ сервера, нужен ответ сервера
 *
 * @param data - контроллер (или что-то с входом хранилища `sync`)
 * @returns промис, разрешаемый при пустой очереди
 */
export function whenSynced(data: Pick<DataController, 'sync'>): Promise<void> {
    return new Promise((resolve) => {
        let unsubscribe: (() => void) | null = null;
        let done = false;
        const check = () => {
            if (done || data.sync.pending().length > 0) return;
            done = true;
            unsubscribe?.();
            resolve();
        };
        unsubscribe = data.sync.subscribePending(check);
        check();
    });
}

/**
 * Подставной API-клиент для тестов: хранит типы и объекты в памяти и применяет наборы изменений
 * общими правилами контракта (`checkChangeset`)
 *
 * @param types - описания типов, отдаваемые по `/types`
 * @param objects - объекты, отдаваемые по `/objects`
 * @param options - каталог расширений (включает поведение «как сервер»)
 * @returns клиент с возможностью отклонить следующий набор
 */
export function createFakeApi(
    types: unknown[] = [],
    objects: unknown[] = [],
    options: FakeApiOptions = {},
): FakeApi {
    let rejection: ApiError | null = null;
    const serverMode = options.extensions !== undefined;
    // Состояние объектов после принятых наборов: поверх исходных `objects`; `null` — удалён
    const accepted = new Map<string, RuleObject | null>();
    const typeMap = () => new Map((api.types as RuleType[]).map((t) => [t.id, t]));
    const isDisabled = (type: string | undefined): boolean => {
        const owner = type === undefined ? undefined : typeMap().get(type)?.extension;
        return owner !== undefined && api.extensions.some((e) => e.id === owner && !e.connected);
    };
    // Текущее состояние объектов «на сервере»: исходные объекты с принятыми наборами
    const current = (): Map<string, DataObject> => {
        const known = new Map<string, DataObject>();
        for (const o of api.objects as Partial<DataObject>[]) {
            const id = o.id as string;
            known.set(id, {
                id,
                type: o.type as string,
                parent: o.parent ?? null,
                number: o.number ?? 1,
                properties: o.properties ?? {},
            });
        }
        for (const [id, value] of accepted) {
            if (value) known.set(id, { id, ...value });
            else known.delete(id);
        }
        return known;
    };
    const visibleObjects = () =>
        (api.objects as { type: string }[]).filter((o) => !isDisabled(o.type));
    // Применённые наборы: идентификатор → курсор (повтор отвечает `duplicate` с прежним курсором)
    const appliedSeq = new Map<string, number>();
    const journal: AppliedChangeset[] = [];
    let lastSeq = 0;

    /**
     * Применяет один набор пакета атомарно, как сервер: отказ не меняет данных и не влияет на соседние наборы
     *
     * @param changeset - набор из тела запроса
     * @returns итог набора
     */
    function applyChangeset(changeset: SubmittedChangeset): ChangesetResult {
        const { id } = changeset;
        const known = appliedSeq.get(id);
        if (known !== undefined) return { id, status: 'duplicate', seq: known };
        if (rejection) {
            const error = rejection;
            rejection = null;
            return rejectedResult(id, error.message, error.code);
        }
        const operations = changeset.operations;
        const check = checkChangeset(typeMap(), current(), operations, { isDisabled });
        if (!check.ok) return rejectedResult(id, check.error, check.code);
        if (serverMode) {
            const map = new Map((api.objects as DataObject[]).map((o) => [o.id, { ...o }]));
            applyOperations(map, operations as unknown as Operation[]);
            api.objects = [...map.values()];
        } else {
            for (const [objectId, value] of check.changes) accepted.set(objectId, value);
        }
        lastSeq += 1;
        appliedSeq.set(id, lastSeq);
        journal.push({ id, seq: lastSeq, touched: [...check.changes.keys()] });
        api.changesets.push(changeset);
        return { id, status: 'applied', seq: lastSeq };
    }

    /**
     * Догон `GET /changes?since=N`: финальное состояние объектов, затронутых наборами после `N`
     *
     * @param since - курсор клиента
     * @returns пакет догона либо `{ resync: true }`, если курсор впереди журнала
     */
    function changesSince(since: number): unknown {
        if (since > lastSeq) return { resync: true };
        const after = journal.filter((c) => c.seq > since);
        const state = current();
        const touched = new Set(after.flatMap((c) => c.touched));
        const upserts: DataObject[] = [];
        const deletes: string[] = [];
        for (const id of touched) {
            const object = state.get(id);
            if (object && !isDisabled(object.type)) upserts.push(object);
            else deletes.push(id);
        }
        return {
            toSeq: after.length > 0 ? lastSeq : since,
            changesetIds: after.map((c) => c.id),
            upserts,
            deletes,
        };
    }

    const catalogItem = (e: Required<FakeExtension>) => ({ ...e });
    const api: FakeApi = {
        types: withPlatformTypes(types),
        objects,
        changesets: [],
        extensions: (options.extensions ?? []).map((e) => ({
            name: e.id,
            description: '',
            icon: 'puzzle',
            defaultEnabled: true,
            commands: [],
            ...e,
        })),
        rejectNext(status, message, code) {
            rejection = new ApiError(status, message, code);
        },
        get: (path) => {
            if (path === 'types') return Promise.resolve(api.types as never);
            if (path === 'objects') return Promise.resolve(visibleObjects() as never);
            // Снимок отдаёт те же объекты, что `GET /objects`, и курсор последнего набора
            if (path === 'snapshot') {
                return Promise.resolve({
                    seq: lastSeq,
                    types: api.types,
                    objects: visibleObjects(),
                } as never);
            }
            const changes = /^changes\?since=(\d+)$/.exec(path);
            if (changes) return Promise.resolve(changesSince(Number(changes[1])) as never);
            if (path === 'extensions' && serverMode) {
                return Promise.resolve(api.extensions.map(catalogItem) as never);
            }
            return Promise.reject(new ApiError(404, `нет маршрута ${path}`));
        },
        post: (path, body) => {
            if (path !== 'changesets')
                return Promise.reject(new ApiError(404, `нет маршрута ${path}`));
            const batch = (body as { changesets?: unknown } | undefined)?.changesets;
            if (!Array.isArray(batch)) {
                return Promise.reject(
                    new ApiError(400, 'Тело запроса должно иметь вид { changesets: [...] }.'),
                );
            }
            // Отказ уровня запроса (сеть, авторизация, формат) — ответ целиком не 200
            if (rejection && rejection.status !== 422) {
                const error = rejection;
                rejection = null;
                return Promise.reject(error);
            }
            const results = (batch as SubmittedChangeset[]).map(applyChangeset);
            return Promise.resolve(results as never);
        },
        put: (path, body) => {
            const match = /^extensions\/([^/]+)\/connection$/.exec(path);
            if (!match || !serverMode) return Promise.reject(new Error('не используется'));
            const item = api.extensions.find((e) => e.id === match[1]);
            if (!item) return Promise.reject(new ApiError(404, 'Расширение не найдено.'));
            const connected = (body as { connected?: unknown } | undefined)?.connected;
            if (typeof connected !== 'boolean') {
                return Promise.reject(new ApiError(400, 'Укажите connected.'));
            }
            item.connected = connected;
            return Promise.resolve(catalogItem(item) as never);
        },
        delete: () => Promise.reject(new Error('не используется')),
    };
    return api;
}
