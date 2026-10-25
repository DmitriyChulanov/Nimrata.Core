import { ApiError } from '../api/apiClient';
import type { ApiClient } from '../api/apiClient';

/** Поддельный API-клиент в памяти для тестов `DataController`: отдаёт типы и объекты, записывает наборы изменений. */
export interface FakeApi extends ApiClient {
    types: unknown[];
    objects: unknown[];
    /** Все принятые наборы изменений (тела запросов). */
    changesets: { operations: Record<string, unknown>[] }[];
    /** Следующий набор будет отклонён этой ошибкой. */
    rejectNext(status: number, message: string): void;
}

interface Known {
    type: string;
    parent: string | null;
}

interface TypeLike {
    id: string;
    allowedChildren?: string[];
}

/**
 * Проверка допустимости родителя так же, как на сервере: пустой список `allowedChildren` —
 * запрет любых потомков, отсутствие поля — без ограничений, корень допустим для любого типа.
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

export function createFakeApi(types: unknown[] = [], objects: unknown[] = []): FakeApi {
    let rejection: ApiError | null = null;
    // Состояние объектов после принятых наборов: поверх исходных `objects`; `null` — удалён.
    const accepted = new Map<string, Known | null>();
    const validate = (operations: Record<string, unknown>[]): Map<string, Known> => {
        const typeMap = new Map((api.types as TypeLike[]).map((t) => [t.id, t]));
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
            if (op.op === 'create') {
                const parent = (op.parent as string | null | undefined) ?? null;
                const parentType = parent ? known.get(parent)?.type : undefined;
                checkParent(typeMap, op.type as string, parentType);
                known.set(id, { type: op.type as string, parent });
            } else if (op.op === 'move') {
                const target = op.parent as { new: string | null } | undefined;
                const current = known.get(id);
                if (target && current) {
                    const parentType = target.new ? known.get(target.new)?.type : undefined;
                    checkParent(typeMap, current.type, parentType);
                    known.set(id, { ...current, parent: target.new });
                }
            } else if (op.op === 'delete') {
                known.delete(id);
            }
        }
        return known;
    };
    const api: FakeApi = {
        types,
        objects,
        changesets: [],
        rejectNext(status, message) {
            rejection = new ApiError(status, message);
        },
        get: (path) => {
            if (path === 'types') return Promise.resolve(api.types as never);
            if (path === 'objects') return Promise.resolve(api.objects as never);
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
                accepted.clear();
                for (const [id, value] of known) accepted.set(id, value);
                for (const o of api.objects as { id: string }[]) {
                    if (!known.has(o.id)) accepted.set(o.id, null);
                }
            } catch (error) {
                return Promise.reject(error);
            }
            api.changesets.push(body as never);
            return Promise.resolve({ id: 'journal-1' } as never);
        },
        put: () => Promise.reject(new Error('не используется')),
        delete: () => Promise.reject(new Error('не используется')),
    };
    return api;
}
