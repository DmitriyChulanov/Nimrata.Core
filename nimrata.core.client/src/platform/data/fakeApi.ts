import { ApiError } from '@platform/api/apiClient';

import { applyOperations } from './undoHistory';

import type { ApiClient } from '@platform/api/apiClient';
import type { ChangesetResult, DataObject } from './DataController';
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
 * Поддельный API-клиент в памяти для тестов `DataController`: отдаёт типы и объекты, записывает наборы изменений
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
 * Известный подставному API объект: тип, родитель, порядок и свойства
 */
interface Known {
    type: string;
    /** Идентификатор родителя; `null` — корень */
    parent: string | null;
    number: number;
    properties: Record<string, unknown>;
}

/**
 * Описание свойства типа, нужное проверке значения
 */
interface PropertyLike {
    id: string;
    name?: string;
    kind: string;
    category?: string;
    readOnly?: boolean;
    hidden?: boolean;
    /** Допустимые значения перечисления */
    values?: { value: string }[];
    /** Допустимые типы объекта-цели ссылки; отсутствие — любые */
    targetTypes?: string[];
}

/**
 * Часть описания типа, нужная проверкам подставного API
 */
interface TypeLike {
    id: string;
    /** Допустимые типы потомков; отсутствие — без ограничений */
    allowedChildren?: string[];
    /** Расширение-владелец типа; отсутствие — тип платформы */
    extension?: string;
    /** Не более одного объекта типа у родителя */
    singleton?: boolean;
    /** Свойства типа; отсутствие — свойств нет */
    properties?: PropertyLike[];
}

/**
 * Проверка допустимости родителя так же, как на сервере: пустой список `allowedChildren` —
 * запрет любых потомков, отсутствие поля — без ограничений, корень допустим для любого типа
 */
function checkParent(
    types: Map<string, TypeLike>,
    childType: string,
    parentType: string | undefined,
): void {
    if (parentType === undefined) return;
    const allowed = types.get(parentType)?.allowedChildren;
    if (allowed && !allowed.includes(childType)) {
        throw new ApiError(
            422,
            `тип "${childType}" нельзя разместить внутри типа "${parentType}".`,
        );
    }
}

/**
 * Отказ набора (HTTP 422), как `ChangesetRejectedException` сервера
 */
const rejected = (message: string, code?: string): ApiError => new ApiError(422, message, code);

/**
 * «Номер» — целое число не меньше 1
 */
function checkNumber(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw rejected('number должен быть целым числом не меньше 1.');
    }
    return value;
}

/**
 * Набор из тела пакетной записи `POST /changesets`
 */
interface SubmittedChangeset {
    id: string;
    operations: Record<string, unknown>[];
}

/**
 * Итог отклонённого набора по ошибке проверки
 */
function rejectedResult(id: string, error: ApiError): ChangesetResult {
    const result: ChangesetResult = { id, status: 'rejected', detail: error.message };
    if (error.code) result.code = error.code;
    return result;
}

const isRealDate = (text: string): boolean => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return false;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
};

/**
 * Проверка значения свойства так же, как `ValidateValueAsync` сервера: вид, перечисление, ссылка и её `targetTypes`
 */
function checkValue(
    types: Map<string, TypeLike>,
    known: Map<string, Known>,
    typeId: string,
    name: string,
    value: unknown,
): void {
    const descriptor = types.get(typeId)?.properties?.find((p) => p.id === name);
    if (!descriptor) throw rejected(`у типа "${typeId}" нет свойства "${name}".`);
    if (value === null) return;
    const isValid = (() => {
        switch (descriptor.kind) {
            case 'string':
            case 'text':
                return typeof value === 'string';
            case 'integer':
                return typeof value === 'number' && Number.isInteger(value);
            case 'boolean':
                return typeof value === 'boolean';
            case 'date':
                return typeof value === 'string' && isRealDate(value);
            case 'time':
                return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
            case 'enum':
                return (
                    typeof value === 'string' &&
                    (descriptor.values ?? []).some((v) => v.value === value)
                );
            case 'reference':
                // Идентификаторы в тестах не обязаны быть GUID: несуществующую цель отклонит проверка ниже
                return typeof value === 'string';
            default:
                return false;
        }
    })();
    if (!isValid) {
        throw rejected(`значение свойства "${name}" не подходит под вид "${descriptor.kind}".`);
    }
    if (descriptor.kind === 'reference') {
        const target = known.get(value as string);
        if (!target) throw rejected(`свойство "${name}" ссылается на несуществующий объект.`);
        if (descriptor.targetTypes && !descriptor.targetTypes.includes(target.type)) {
            throw rejected(
                `свойство "${name}" не может ссылаться на объект типа "${target.type}".`,
            );
        }
    }
}

/**
 * Платформенные типы без расширения (как в миграциях сервера `0023`, `0024`), которые есть у каждого пользователя
 */
const PLATFORM_TYPES: (TypeLike & Record<string, unknown>)[] = [
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

function withPlatformTypes(types: unknown[]): unknown[] {
    const known = new Set((types as TypeLike[]).map((t) => t.id));
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
 * Подставной API-клиент для тестов: хранит типы и объекты в памяти и применяет наборы изменений
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
    const accepted = new Map<string, Known | null>();
    const typeMap = () => new Map((api.types as TypeLike[]).map((t) => [t.id, t]));
    const isDisabled = (type: string | undefined): boolean => {
        const owner = type === undefined ? undefined : typeMap().get(type)?.extension;
        return owner !== undefined && api.extensions.some((e) => e.id === owner && !e.connected);
    };
    const validate = (operations: Record<string, unknown>[]): Map<string, Known> => {
        const typesById = typeMap();
        const known = new Map<string, Known>();
        for (const o of api.objects as {
            id: string;
            type: string;
            parent: string | null;
            number?: number;
            properties?: Record<string, unknown>;
        }[]) {
            known.set(o.id, {
                type: o.type,
                parent: o.parent ?? null,
                number: o.number ?? 1,
                properties: o.properties ?? {},
            });
        }
        for (const [id, value] of accepted) {
            if (value) known.set(id, value);
            else known.delete(id);
        }
        const disabledGuard = (type: string | undefined) => {
            if (isDisabled(type)) {
                throw rejected('Расширение отключено.', 'extension_disabled');
            }
        };
        const singletonGuard = (typeId: string, parent: string | null, selfId: string) => {
            if (!typesById.get(typeId)?.singleton) return;
            for (const [otherId, other] of known) {
                if (otherId !== selfId && other.type === typeId && other.parent === parent) {
                    throw rejected('Такой объект уже есть у этого родителя.', 'singleton_exists');
                }
            }
        };
        // Проверка нового родителя: существует, расширение подключено, тип потомка допустим
        const parentGuard = (childType: string, parent: string | null) => {
            if (parent === null) return;
            const parentRow = known.get(parent);
            if (!parentRow) throw rejected(`родитель ${parent} не найден.`);
            disabledGuard(parentRow.type);
            checkParent(typesById, childType, parentRow.type);
        };
        const targetOf = (id: string): Known => {
            const target = known.get(id);
            if (!target) throw rejected(`объект ${id} не найден.`);
            disabledGuard(target.type);
            return target;
        };
        for (const op of operations) {
            const id = op.id as string;
            if (op.op === 'create') {
                const typeId = op.type as string;
                const type = typesById.get(typeId);
                if (!type) throw rejected(`тип "${typeId}" неизвестен.`);
                disabledGuard(typeId);
                if (known.has(id)) throw rejected(`идентификатор ${id} уже занят.`);
                const parent = (op.parent as string | null | undefined) ?? null;
                parentGuard(typeId, parent);
                singletonGuard(typeId, parent, id);
                const properties: Record<string, unknown> = {};
                for (const [name, value] of Object.entries(
                    (op.properties as Record<string, unknown> | undefined) ?? {},
                )) {
                    checkValue(typesById, known, typeId, name, value);
                    if (value !== null) properties[name] = value;
                }
                known.set(id, {
                    type: typeId,
                    parent,
                    number: op.number === undefined ? 1 : checkNumber(op.number),
                    properties,
                });
            } else if (op.op === 'update') {
                const target = targetOf(id);
                const properties = { ...target.properties };
                const changes = (op.changes ?? {}) as Record<
                    string,
                    { old?: unknown; new?: unknown }
                >;
                for (const [name, change] of Object.entries(changes)) {
                    // LWW: «было» не сверяется, нужно только «стало»
                    if (!('new' in change)) {
                        throw rejected(`для свойства "${name}" нужно значение new (стало).`);
                    }
                    checkValue(typesById, known, target.type, name, change.new);
                    if (change.new === null || change.new === undefined) delete properties[name];
                    else properties[name] = change.new;
                }
                known.set(id, { ...target, properties });
            } else if (op.op === 'move') {
                const target = targetOf(id);
                const parentChange = op.parent as { old?: string | null; new: string | null };
                const numberChange = op.number as { old?: number; new: number } | undefined;
                let { parent, number } = target;
                if (parentChange) {
                    if (parentChange.new !== null) {
                        for (
                            let ancestor: string | null = parentChange.new;
                            ancestor !== null;
                            ancestor = known.get(ancestor)?.parent ?? null
                        ) {
                            if (ancestor === id) {
                                throw rejected(
                                    'нельзя переместить объект в самого себя или в своего потомка (получится цикл).',
                                );
                            }
                        }
                    }
                    parentGuard(target.type, parentChange.new);
                    singletonGuard(target.type, parentChange.new, id);
                    parent = parentChange.new;
                }
                if (numberChange) number = checkNumber(numberChange.new);
                known.set(id, { ...target, parent, number });
            } else if (op.op === 'delete') {
                targetOf(id);
                for (const other of known.values()) {
                    if (other.parent === id) {
                        throw rejected(
                            `у объекта ${id} остались потомки: перечислите в наборе все удаляемые объекты, потомков раньше родителей.`,
                        );
                    }
                }
                known.delete(id);
            }
        }
        return known;
    };
    // Применённые наборы: идентификатор → курсор (повтор отвечает `duplicate` с прежним курсором)
    const appliedSeq = new Map<string, number>();
    let lastSeq = 0;
    /**
     * Применяет один набор пакета атомарно, как сервер: отказ не меняет данных и не влияет на соседние наборы
     */
    function applyChangeset(changeset: SubmittedChangeset): ChangesetResult {
        const { id } = changeset;
        const known = appliedSeq.get(id);
        if (known !== undefined) return { id, status: 'duplicate', seq: known };
        if (rejection) {
            const error = rejection;
            rejection = null;
            return rejectedResult(id, error);
        }
        const operations = changeset.operations;
        try {
            const result = validate(operations);
            if (serverMode) {
                const map = new Map((api.objects as DataObject[]).map((o) => [o.id, { ...o }]));
                applyOperations(map, operations as unknown as Operation[]);
                api.objects = [...map.values()];
            } else {
                accepted.clear();
                for (const [objectId, value] of result) accepted.set(objectId, value);
                for (const o of api.objects as { id: string }[]) {
                    if (!result.has(o.id)) accepted.set(o.id, null);
                }
            }
        } catch (error) {
            if (error instanceof ApiError) return rejectedResult(id, error);
            throw error;
        }
        lastSeq += 1;
        appliedSeq.set(id, lastSeq);
        api.changesets.push(changeset);
        return { id, status: 'applied', seq: lastSeq };
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
            if (path === 'objects') {
                const visible = (api.objects as { type: string }[]).filter(
                    (o) => !isDisabled(o.type),
                );
                return Promise.resolve(visible as never);
            }
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
