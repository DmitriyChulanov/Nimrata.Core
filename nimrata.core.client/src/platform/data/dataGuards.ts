/**
 * Проверки формы данных, пришедших с границы (ответы сервера, сообщения push, IndexedDB): вместо
 * приведения типов `as` данные проверяются, и неверные считаются ошибкой, а не принимаются молча
 */
import type { ChangesetResult, DataObject } from './DataController';
import type { PendingChangeset, RemoteChanges, StoreSnapshot } from './dataStore';
import type { Operation } from './undoHistory';
import type { TypeDefinition } from '@platform/types/types';

/**
 * Проверяет, что значение — объект
 *
 * @param value - проверяемое значение
 * @returns `true`, если это непустая ссылка на объект (не массив)
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Проверяет, что значение — массив строк
 *
 * @param value - проверяемое значение
 * @returns `true`, если каждый элемент — строка
 */
function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Проверяет, что значение — неотрицательный целый курсор `seq`
 *
 * @param value - проверяемое значение
 * @returns `true`, если это целое число ≥ 0
 */
function isSeq(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Проверяет, что значение — объект модели
 *
 * @param value - проверяемое значение
 * @returns `true`, если есть `id`, `type`, `parent` (строка или `null`), `number` и `properties`
 */
export function isDataObject(value: unknown): value is DataObject {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.type === 'string' &&
        (value.parent === null || typeof value.parent === 'string') &&
        typeof value.number === 'number' &&
        isRecord(value.properties)
    );
}

/**
 * Проверяет, что значение похоже на описание типа: идентификатор и название (остальное
 * необязательно и проверяется там, где используется)
 *
 * @param value - проверяемое значение
 * @returns `true`, если есть строковые `id` и `name`
 */
function isTypeDefinition(value: unknown): value is TypeDefinition {
    return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

/**
 * Проверяет, что значение — итог набора из ответа `POST /api/changesets`
 *
 * @param value - проверяемое значение
 * @returns `true`, если форма соответствует `ChangesetResult`; у применённого и повтора нужны `seq` и `prevSeq`
 */
export function isChangesetResult(value: unknown): value is ChangesetResult {
    if (!isRecord(value) || typeof value.id !== 'string') return false;
    if (value.code !== undefined && typeof value.code !== 'string') return false;
    if (value.detail !== undefined && typeof value.detail !== 'string') return false;
    switch (value.status) {
        case 'applied':
        case 'duplicate':
            return isSeq(value.seq) && isSeq(value.prevSeq);
        case 'rejected':
            return true;
        default:
            return false;
    }
}

/**
 * Проверяет, что значение — пакет догона `GET /api/changes`
 *
 * @param value - проверяемое значение
 * @returns `true`, если форма соответствует `RemoteChanges`
 */
export function isRemoteChanges(value: unknown): value is RemoteChanges {
    return (
        isRecord(value) &&
        isSeq(value.toSeq) &&
        Array.isArray(value.upserts) &&
        value.upserts.every(isDataObject) &&
        isStringArray(value.deletes) &&
        isStringArray(value.changesetIds)
    );
}

/**
 * Проверяет, что значение — снимок `GET /api/snapshot` (или сохранённый в IndexedDB)
 *
 * @param value - проверяемое значение
 * @returns `true`, если форма соответствует `StoreSnapshot`
 */
export function isStoreSnapshot(value: unknown): value is StoreSnapshot {
    return (
        isRecord(value) &&
        isSeq(value.seq) &&
        Array.isArray(value.types) &&
        value.types.every(isTypeDefinition) &&
        Array.isArray(value.objects) &&
        value.objects.every(isDataObject)
    );
}

/**
 * Проверяет, что значение — операция набора
 *
 * @param value - проверяемое значение
 * @returns `true`, если есть известный вид `op` и строковый `id`
 */
function isOperation(value: unknown): value is Operation {
    if (!isRecord(value) || typeof value.id !== 'string') return false;
    switch (value.op) {
        case 'create':
            return typeof value.type === 'string' && isRecord(value.properties);
        case 'update':
            return isRecord(value.changes);
        case 'move':
        case 'delete':
            return true;
        default:
            return false;
    }
}

/**
 * Проверяет, что значение — неподтверждённый набор очереди
 *
 * @param value - проверяемое значение
 * @returns `true`, если есть строковый `id` и массив операций
 */
export function isPendingChangeset(value: unknown): value is PendingChangeset {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        Array.isArray(value.operations) &&
        value.operations.every(isOperation)
    );
}
