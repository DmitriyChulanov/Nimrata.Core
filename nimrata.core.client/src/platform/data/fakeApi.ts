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
 * Известный подставному API объект: тип и родитель
 */
interface Known {
    type: string;
    /** Идентификатор родителя; `null` — корень */
    parent: string | null;
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
 * Платформенные типы без расширения (как в миграциях сервера), которые есть у каждого пользователя
 */
const PLATFORM_TYPES = [
    { id: 'SettingsRoot', name: 'Настройки', sealed: true, singleton: true, icon: 'settings' },
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
        for (const o of api.objects as { id: string; type: string; parent: string | null }[]) {
            known.set(o.id, { type: o.type, parent: o.parent ?? null });
        }
        for (const [id, value] of accepted) {
            if (value) known.set(id, value);
            else known.delete(id);
        }
        for (const op of operations) {
            const id = op.id as string;
            const type = op.op === 'create' ? (op.type as string) : known.get(id)?.type;
            if (isDisabled(type)) {
                throw new ApiError(422, 'Расширение отключено.', 'extension_disabled');
            }
            if (op.op === 'create') {
                const parent = (op.parent as string | null | undefined) ?? null;
                const parentType = parent ? known.get(parent)?.type : undefined;
                checkParent(typesById, op.type as string, parentType);
                if (typesById.get(op.type as string)?.singleton) {
                    for (const other of known.values()) {
                        if (other.type === op.type && other.parent === parent) {
                            throw new ApiError(
                                409,
                                'Такой объект уже есть у этого родителя.',
                                'singleton_exists',
                            );
                        }
                    }
                }
                known.set(id, { type: op.type as string, parent });
            } else if (op.op === 'move') {
                const target = op.parent as { new: string | null } | undefined;
                const current = known.get(id);
                if (target && current) {
                    const parentType = target.new ? known.get(target.new)?.type : undefined;
                    checkParent(typesById, current.type, parentType);
                    known.set(id, { ...current, parent: target.new });
                }
            } else if (op.op === 'delete') {
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
