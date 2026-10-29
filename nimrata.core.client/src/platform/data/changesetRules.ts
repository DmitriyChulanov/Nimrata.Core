/**
 * Структурные правила Набора изменений, общие для подставного API и хранилища клиента: те же
 * проверки, что делает сервер (контракт `contracts/changeset`)
 */

/**
 * Объект, известный проверке: тип, родитель, номер и свойства
 */
export interface RuleObject {
    /** Идентификатор типа */
    type: string;
    /** Идентификатор родителя; `null` — корень */
    parent: string | null;
    /** Номер среди соседей */
    number: number;
    /** Значения свойств */
    properties: Record<string, unknown>;
}

/**
 * Описание свойства типа, нужное проверке значения
 */
export interface RuleProperty {
    /** Идентификатор свойства */
    id: string;
    /** Вид значения */
    kind: string;
    /** Допустимые значения перечисления */
    values?: { value: string }[];
    /** Допустимые типы объекта-цели ссылки; отсутствие — любые */
    targetTypes?: string[];
}

/**
 * Часть описания типа, нужная проверкам
 */
export interface RuleType {
    /** Идентификатор типа */
    id: string;
    /** Допустимые типы потомков; отсутствие — без ограничений */
    allowedChildren?: string[];
    /** Расширение-владелец типа; отсутствие — тип платформы */
    extension?: string;
    /** Не более одного объекта типа у родителя */
    singleton?: boolean;
    /** Свойства типа; отсутствие — свойств нет */
    properties?: RuleProperty[];
}

/**
 * Итог проверки набора: изменения поверх исходной модели (`null` — объект удалён) либо отказ
 */
export type RuleCheck =
    | { ok: true; changes: Map<string, RuleObject | null> }
    | { ok: false; error: string; code?: string };

/**
 * Нарушение правила: набор отклоняется целиком
 */
class RuleViolation extends Error {
    /** Машинный код отказа (`singleton_exists`, `extension_disabled`) */
    readonly code: string | undefined;

    /**
     * Создаёт нарушение правила
     *
     * @param message - причина для пользователя
     * @param code - машинный код отказа
     */
    constructor(message: string, code?: string) {
        super(message);
        this.code = code;
    }
}

/**
 * «Номер» — целое число не меньше 1
 *
 * @param value - значение номера из операции
 * @returns номер
 */
function checkNumber(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new RuleViolation('number должен быть целым числом не меньше 1.');
    }
    return value;
}

/**
 * Существующая календарная дата в формате `YYYY-MM-DD`
 *
 * @param text - проверяемая строка
 * @returns `true`, если дата настоящая
 */
function isRealDate(text: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return false;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

/**
 * Подходит ли значение под вид свойства
 *
 * @param descriptor - описание свойства
 * @param value - значение (не `null`)
 * @returns `true`, если вид совпадает
 */
function matchesKind(descriptor: RuleProperty, value: unknown): boolean {
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
            // Идентификаторы в тестах не обязаны быть GUID: несуществующую цель отклонит проверка цели
            return typeof value === 'string';
        default:
            return false;
    }
}

/**
 * Параметры проверки набора
 */
export interface RuleOptions {
    /** Отключено ли расширение, владеющее типом; по умолчанию все включены */
    isDisabled?: (type: string) => boolean;
}

/**
 * Проверяет набор так же, как сервер: существование объектов и родителей, `allowedChildren`,
 * отсутствие цикла, singleton, включённость расширения, отсутствие оставшихся потомков у удаляемого,
 * занятый идентификатор у `create`, вид и цель значений свойств. «Было» не сверяется (LWW).
 * Исходная модель не меняется
 *
 * @param types - типы по идентификатору
 * @param base - модель до набора
 * @param operations - операции набора в порядке применения
 * @param options - включённость расширений
 * @returns изменения модели либо первый отказ
 */
export function checkChangeset(
    types: ReadonlyMap<string, RuleType>,
    base: ReadonlyMap<string, RuleObject>,
    operations: readonly Record<string, unknown>[],
    options: RuleOptions = {},
): RuleCheck {
    const changes = new Map<string, RuleObject | null>();
    const get = (id: string): RuleObject | undefined =>
        changes.has(id) ? (changes.get(id) ?? undefined) : base.get(id);
    function* entries(): Generator<[string, RuleObject]> {
        for (const [id, value] of base) if (!changes.has(id)) yield [id, value];
        for (const [id, value] of changes) if (value) yield [id, value];
    }
    const disabledGuard = (type: string | undefined) => {
        if (type !== undefined && options.isDisabled?.(type)) {
            throw new RuleViolation('Расширение отключено.', 'extension_disabled');
        }
    };
    const singletonGuard = (typeId: string, parent: string | null, selfId: string) => {
        if (!types.get(typeId)?.singleton) return;
        for (const [otherId, other] of entries()) {
            if (otherId !== selfId && other.type === typeId && other.parent === parent) {
                throw new RuleViolation(
                    'Такой объект уже есть у этого родителя.',
                    'singleton_exists',
                );
            }
        }
    };
    // Новый родитель существует, расширение подключено, тип потомка допустим
    const parentGuard = (childType: string, parent: string | null) => {
        if (parent === null) return;
        const parentRow = get(parent);
        if (!parentRow) throw new RuleViolation(`родитель ${parent} не найден.`);
        disabledGuard(parentRow.type);
        const allowed = types.get(parentRow.type)?.allowedChildren;
        if (allowed && !allowed.includes(childType)) {
            throw new RuleViolation(
                `тип "${childType}" нельзя разместить внутри типа "${parentRow.type}".`,
            );
        }
    };
    const targetOf = (id: string): RuleObject => {
        const target = get(id);
        if (!target) throw new RuleViolation(`объект ${id} не найден.`);
        disabledGuard(target.type);
        return target;
    };
    const checkValue = (typeId: string, name: string, value: unknown) => {
        const descriptor = types.get(typeId)?.properties?.find((p) => p.id === name);
        if (!descriptor) throw new RuleViolation(`у типа "${typeId}" нет свойства "${name}".`);
        if (value === null) return;
        if (!matchesKind(descriptor, value)) {
            throw new RuleViolation(
                `значение свойства "${name}" не подходит под вид "${descriptor.kind}".`,
            );
        }
        if (descriptor.kind === 'reference') {
            const target = get(value as string);
            if (!target) {
                throw new RuleViolation(`свойство "${name}" ссылается на несуществующий объект.`);
            }
            if (descriptor.targetTypes && !descriptor.targetTypes.includes(target.type)) {
                throw new RuleViolation(
                    `свойство "${name}" не может ссылаться на объект типа "${target.type}".`,
                );
            }
        }
    };

    try {
        for (const op of operations) {
            const id = op.id as string;
            if (op.op === 'create') {
                const typeId = op.type as string;
                if (!types.get(typeId)) throw new RuleViolation(`тип "${typeId}" неизвестен.`);
                disabledGuard(typeId);
                if (get(id)) throw new RuleViolation(`идентификатор ${id} уже занят.`);
                const parent = (op.parent as string | null | undefined) ?? null;
                parentGuard(typeId, parent);
                singletonGuard(typeId, parent, id);
                const properties: Record<string, unknown> = {};
                for (const [name, value] of Object.entries(
                    (op.properties as Record<string, unknown> | undefined) ?? {},
                )) {
                    checkValue(typeId, name, value);
                    if (value !== null) properties[name] = value;
                }
                changes.set(id, {
                    type: typeId,
                    parent,
                    number: op.number === undefined ? 1 : checkNumber(op.number),
                    properties,
                });
            } else if (op.op === 'update') {
                const target = targetOf(id);
                const properties = { ...target.properties };
                const updates = (op.changes ?? {}) as Record<
                    string,
                    { old?: unknown; new?: unknown }
                >;
                for (const [name, change] of Object.entries(updates)) {
                    // LWW: «было» не сверяется, нужно только «стало»
                    if (!('new' in change)) {
                        throw new RuleViolation(
                            `для свойства "${name}" нужно значение new (стало).`,
                        );
                    }
                    checkValue(target.type, name, change.new);
                    if (change.new === null || change.new === undefined) delete properties[name];
                    else properties[name] = change.new;
                }
                changes.set(id, { ...target, properties });
            } else if (op.op === 'move') {
                const target = targetOf(id);
                const parentChange = op.parent as { new: string | null } | undefined;
                const numberChange = op.number as { new: number } | undefined;
                let { parent, number } = target;
                if (parentChange) {
                    for (
                        let ancestor: string | null = parentChange.new;
                        ancestor !== null;
                        ancestor = get(ancestor)?.parent ?? null
                    ) {
                        if (ancestor === id) {
                            throw new RuleViolation(
                                'нельзя переместить объект в самого себя или в своего потомка (получится цикл).',
                            );
                        }
                    }
                    parentGuard(target.type, parentChange.new);
                    singletonGuard(target.type, parentChange.new, id);
                    parent = parentChange.new;
                }
                if (numberChange) number = checkNumber(numberChange.new);
                changes.set(id, { ...target, parent, number });
            } else if (op.op === 'delete') {
                targetOf(id);
                for (const [, other] of entries()) {
                    if (other.parent === id) {
                        throw new RuleViolation(
                            `у объекта ${id} остались потомки: перечислите в наборе все удаляемые объекты, потомков раньше родителей.`,
                        );
                    }
                }
                changes.set(id, null);
            } else {
                throw new RuleViolation(`неизвестная операция "${String(op.op)}".`);
            }
        }
    } catch (error) {
        if (!(error instanceof RuleViolation)) throw error;
        return error.code === undefined
            ? { ok: false, error: error.message }
            : { ok: false, error: error.message, code: error.code };
    }
    return { ok: true, changes };
}
