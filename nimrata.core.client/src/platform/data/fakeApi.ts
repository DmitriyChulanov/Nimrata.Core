import { ApiError } from '@platform/api/apiClient';

import { applyOperations } from './undoHistory';

import type { ApiClient } from '@platform/api/apiClient';
import type { DataObject } from './DataController';
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
    /** Все принятые наборы изменений (тела запросов) */
    changesets: { operations: Record<string, unknown>[] }[];
    /** Каталог расширений с текущим состоянием подключений */
    extensions: Required<FakeExtension>[];
    /** Следующий набор будет отклонён этой ошибкой (`code` — машинный код ответа) */
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
 * Отказ набора из-за расхождения с текущими данными (HTTP 409)
 */
const conflict = (message: string, code?: string): ApiError => new ApiError(409, message, code);

/**
 * Значения «пусто» (нет значения или `null`) равны друг другу, прочие сравниваются по содержимому
 */
function valuesEqual(left: unknown, right: unknown): boolean {
    const empty = (value: unknown) => value === undefined || value === null;
    if (empty(left) || empty(right)) return empty(left) && empty(right);
    return JSON.stringify(left) === JSON.stringify(right);
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
                    throw conflict('Такой объект уже есть у этого родителя.', 'singleton_exists');
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
                if (known.has(id)) throw conflict(`идентификатор ${id} уже занят.`);
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
                    checkValue(typesById, known, target.type, name, change.new);
                    if (!valuesEqual(properties[name], change.old)) {
                        throw conflict(
                            `свойство "${name}" изменилось с момента загрузки (значение «было» не совпало с текущим).`,
                        );
                    }
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
                    if (!valuesEqual(target.parent, parentChange.old)) {
                        throw conflict(
                            'родитель (parent) изменился с момента загрузки (значение «было» не совпало с текущим).',
                        );
                    }
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
                if (numberChange) {
                    if (numberChange.old !== target.number) {
                        throw conflict(
                            'номер (number) изменился с момента загрузки (значение «было» не совпало с текущим).',
                        );
                    }
                    number = checkNumber(numberChange.new);
                }
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
            if (rejection) {
                const error = rejection;
                rejection = null;
                return Promise.reject(error);
            }
            const operations =
                (body as { operations?: Record<string, unknown>[] }).operations ?? [];
            try {
                const known = validate(operations);
                if (serverMode) {
                    const map = new Map((api.objects as DataObject[]).map((o) => [o.id, { ...o }]));
                    applyOperations(map, operations as unknown as Operation[]);
                    api.objects = [...map.values()];
                } else {
                    accepted.clear();
                    for (const [id, value] of known) accepted.set(id, value);
                    for (const o of api.objects as { id: string }[]) {
                        if (!known.has(o.id)) accepted.set(o.id, null);
                    }
                }
            } catch (error) {
                return Promise.reject(error);
            }
            api.changesets.push(body as never);
            return Promise.resolve({ id: 'journal-1' } as never);
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
