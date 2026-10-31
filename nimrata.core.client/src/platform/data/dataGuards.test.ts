import { describe, expect, it } from 'vitest';

import {
    isChangesetResult,
    isPendingChangeset,
    isRemoteChanges,
    isStoreSnapshot,
} from './dataGuards';

const object = { id: 'a', type: 'Note', parent: null, number: 1, properties: {} };

/**
 * Проверки формы данных с границы: ответы сервера, push, IndexedDB
 */
describe('dataGuards', () => {
    /**
     * Проверяет итог набора: у применённого и повтора обязательны `seq` и `prevSeq`
     */
    it('isChangesetResult_requiresSeqAndPrevSeqUnlessRejected', () => {
        expect(isChangesetResult({ id: 'c', status: 'applied', seq: 3, prevSeq: 0 })).toBe(true);
        expect(isChangesetResult({ id: 'c', status: 'duplicate', seq: 3, prevSeq: 1 })).toBe(true);
        expect(isChangesetResult({ id: 'c', status: 'rejected', detail: 'нет' })).toBe(true);
        expect(isChangesetResult({ id: 'c', status: 'applied', seq: 3 })).toBe(false);
        expect(isChangesetResult({ id: 'c', status: 'other', seq: 3, prevSeq: 0 })).toBe(false);
        expect(isChangesetResult({ status: 'rejected' })).toBe(false);
        expect(isChangesetResult({ id: 'c', status: 'rejected', code: 7 })).toBe(false);
    });

    /**
     * Проверяет пакет догона и снимок: объекты и списки должны быть верной формы
     */
    it('isRemoteChangesAndSnapshot_checkNestedShapes', () => {
        const changes = { toSeq: 1, changesetIds: ['c'], upserts: [object], deletes: ['b'] };
        expect(isRemoteChanges(changes)).toBe(true);
        expect(isRemoteChanges({ ...changes, upserts: [{ id: 'a' }] })).toBe(false);
        expect(isRemoteChanges({ ...changes, toSeq: -1 })).toBe(false);
        expect(
            isStoreSnapshot({
                seq: 0,
                types: [{ id: 'Note', name: 'Заметка' }],
                objects: [object],
            }),
        ).toBe(true);
        expect(isStoreSnapshot({ seq: 0, types: [{}], objects: [] })).toBe(false);
        expect(isStoreSnapshot(null)).toBe(false);
    });

    /**
     * Проверяет набор очереди: известный вид операций и строковые идентификаторы
     */
    it('isPendingChangeset_checksOperations', () => {
        expect(isPendingChangeset({ id: 'c', operations: [{ op: 'delete', id: 'a' }] })).toBe(true);
        expect(isPendingChangeset({ id: 'c', operations: [{ op: 'drop', id: 'a' }] })).toBe(false);
        expect(isPendingChangeset({ id: 'c', operations: 'none' })).toBe(false);
    });
});
