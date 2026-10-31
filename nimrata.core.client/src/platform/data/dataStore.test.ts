import { describe, expect, it } from 'vitest';

import { createDataStore } from './dataStore';

import type { DataObject } from './DataController';
import type { TypeDefinition } from '@platform/types/types';
import type { Operation } from './undoHistory';

const types = [
    { id: 'Folder', name: 'Папка', extension: 't', extensionVersion: 1 },
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        properties: [
            { id: 'name', name: 'Имя', kind: 'string' },
            { id: 'done', name: 'Готово', kind: 'boolean' },
        ],
    },
] as TypeDefinition[];

const note = (id: string, parent: string | null, name: string, number = 1): DataObject => ({
    id,
    type: 'Note',
    parent,
    number,
    properties: { name },
});

/**
 * Хранилище с папкой `root` и двумя заметками в ней
 */
function loaded() {
    let next = 0;
    const store = createDataStore({ newChangesetId: () => `cs${++next}` });
    store.reset({
        seq: 10,
        types,
        objects: [
            { id: 'root', type: 'Folder', parent: null, number: 1, properties: {} },
            note('a', 'root', 'A', 1),
            note('b', 'root', 'B', 2),
        ],
    });
    return store;
}

/**
 * Локальная правка: применяет операции к видимой модели и ставит набор в очередь
 */
function edit(store: ReturnType<typeof createDataStore>, operations: Operation[]) {
    const local = store.beginLocal();
    for (const operation of operations) local.apply(operation);
    return local.commit(operations);
}

const rename = (id: string, from: string, to: string): Operation => ({
    op: 'update',
    id,
    changes: { name: { old: from, new: to } },
});

/**
 * Хранилище клиента: подтверждённый слой и очередь неподтверждённых наборов
 */
describe('dataStore: two layers', () => {
    /**
     * Проверяет, что локальная правка видна сразу, а подтверждённый слой и курсор не меняются
     */
    it('localCommit_visibleAtOnce_confirmedLayerAndCursorUntouched', () => {
        const store = loaded();
        edit(store, [rename('a', 'A', 'X')]);

        expect(store.getObject('a')?.properties.name).toBe('X');
        expect(store.getConfirmedObject('a')?.properties.name).toBe('A');
        expect(store.getSeq()).toBe(10);
        expect(store.pending().map((c) => c.id)).toEqual(['cs1']);
    });

    /**
     * Проверяет, что подтверждение переносит набор в подтверждённый слой и сдвигает соседний курсор
     */
    it('confirm_movesChangesetToConfirmedLayer_andAdvancesContiguousCursor', async () => {
        const store = loaded();
        const { outcome } = edit(store, [rename('a', 'A', 'X')]);

        store.confirm('cs1', 11, 10);

        expect(await outcome).toEqual({ ok: true });
        expect(store.pending()).toEqual([]);
        expect(store.getConfirmedObject('a')?.properties.name).toBe('X');
        expect(store.getSeq()).toBe(11);
    });

    /**
     * Проверяет, что подтверждение, у которого предыдущий набор пользователя новее курсора, не сдвигает
     * курсор: между ними есть наборы других вкладок
     */
    it('confirm_prevSeqAheadOfCursor_keepsCursor', () => {
        const store = loaded();
        edit(store, [rename('a', 'A', 'X')]);
        store.confirm('cs1', 15, 12);
        expect(store.getSeq()).toBe(10);
        expect(store.getObject('a')?.properties.name).toBe('X');
    });

    /**
     * Проверяет, что подтверждение сдвигает курсор через дыру в глобальном `seq`, если предыдущий набор
     * пользователя — текущий курсор (между ними только наборы других пользователей)
     */
    it('confirm_prevSeqEqualsCursor_advancesOverGlobalGap', () => {
        const store = loaded();
        edit(store, [rename('a', 'A', 'X')]);
        edit(store, [rename('a', 'X', 'Y')]);

        store.confirm('cs1', 15, 10);
        store.confirm('cs2', 23, 15);

        expect(store.getSeq()).toBe(23);
        expect(store.pending()).toEqual([]);
    });

    /**
     * Проверяет, что входящие изменения ложатся под очередь: своя правка остаётся видимой поверх
     */
    it('applyRemote_rebasesQueueOnTopOfIncomingChanges', () => {
        const store = loaded();
        edit(store, [rename('a', 'A', 'Своё')]);

        store.applyRemote({
            toSeq: 12,
            changesetIds: ['other'],
            upserts: [{ ...note('a', 'root', 'Чужое'), properties: { name: 'Чужое', done: true } }],
            deletes: ['b'],
        });

        expect(store.getSeq()).toBe(12);
        expect(store.getConfirmedObject('a')?.properties).toEqual({ name: 'Чужое', done: true });
        expect(store.getObject('a')?.properties).toEqual({ name: 'Своё', done: true });
        expect(store.getObject('b')).toBeUndefined();
        expect(store.pending()).toHaveLength(1);
    });

    /**
     * Проверяет, что свой набор во входящих узнаётся по id: уходит из очереди и считается подтверждённым
     */
    it('applyRemote_ownChangesetId_leavesQueueAsConfirmed', async () => {
        const store = loaded();
        const { outcome } = edit(store, [rename('a', 'A', 'X')]);

        store.applyRemote({
            toSeq: 11,
            changesetIds: ['cs1'],
            upserts: [note('a', 'root', 'X')],
            deletes: [],
        });

        expect(store.pending()).toEqual([]);
        expect(await outcome).toEqual({ ok: true });
        expect(store.getObject('a')?.properties.name).toBe('X');
    });

    /**
     * Проверяет, что устаревший пакет догона (курсор меньше текущего) не применяется
     */
    it('applyRemote_olderThanCursor_isIgnored', () => {
        const store = loaded();
        store.applyRemote({ toSeq: 5, changesetIds: [], upserts: [], deletes: ['a'] });
        expect(store.getObject('a')).toBeDefined();
        expect(store.getSeq()).toBe(10);
    });

    /**
     * Проверяет, что повторное наложение очереди применяет записанные операции, не зная о хуках:
     * операции набора переиграны как есть
     */
    it('applyRemote_queueReplaysRecordedOperations', () => {
        const store = loaded();
        edit(store, [
            {
                op: 'create',
                id: 'n',
                type: 'Note',
                parent: 'root',
                number: 3,
                properties: { name: 'N' },
            },
        ]);
        store.applyRemote({
            toSeq: 11,
            changesetIds: ['x'],
            upserts: [note('a', 'root', 'Y')],
            deletes: [],
        });
        expect(store.getChildren('root').map((o) => o.id)).toEqual(['a', 'b', 'n']);
    });
});

/**
 * Хранилище клиента: отказ, каскад и уведомление
 */
describe('dataStore: rejection and cascade', () => {
    /**
     * Проверяет, что отказ набора откатывает его и каскадом убирает наборы, правящие созданный в нём объект,
     * а пользователь получает одно сводное уведомление
     */
    it('reject_rollsBackAndCascadesDependents_withSingleNotice', async () => {
        const store = loaded();
        const notices: string[] = [];
        store.onNotice((message) => notices.push(message));
        const created = edit(store, [
            {
                op: 'create',
                id: 'n',
                type: 'Note',
                parent: 'root',
                number: 3,
                properties: { name: 'N' },
            },
        ]);
        const dependent = edit(store, [rename('n', 'N', 'N2')]);
        const independent = edit(store, [rename('a', 'A', 'X')]);

        store.reject(created.id, { error: 'нельзя', status: 422 });

        expect(await created.outcome).toEqual({ ok: false, error: 'нельзя', status: 422 });
        expect(await dependent.outcome).toMatchObject({ ok: false });
        expect(store.getObject('n')).toBeUndefined();
        expect(store.getObject('a')?.properties.name).toBe('X');
        expect(store.pending().map((c) => c.id)).toEqual([independent.id]);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toContain('нельзя');
        expect(notices[0]).toContain('1');
    });

    /**
     * Проверяет, что набор, ставший структурно невалидным после входящих изменений, удаляется из очереди
     * сразу (общими правилами контракта) с уведомлением
     */
    it('applyRemote_queuedChangesetBecomesInvalid_isDroppedWithNotice', async () => {
        const store = loaded();
        const notices: string[] = [];
        store.onNotice((message) => notices.push(message));
        const created = edit(store, [
            {
                op: 'create',
                id: 'n',
                type: 'Note',
                parent: 'root',
                number: 3,
                properties: { name: 'N' },
            },
        ]);

        // Другая вкладка удалила папку вместе с содержимым
        store.applyRemote({
            toSeq: 11,
            changesetIds: ['x'],
            upserts: [],
            deletes: ['a', 'b', 'root'],
        });

        expect(await created.outcome).toMatchObject({ ok: false });
        expect(store.getObject('n')).toBeUndefined();
        expect(store.pending()).toEqual([]);
        expect(notices).toHaveLength(1);
    });

    /**
     * Проверяет, что итог для набора, которого уже нет в очереди, ничего не меняет
     */
    it('confirmOrReject_unknownChangeset_isIgnored', () => {
        const store = loaded();
        store.confirm('nope', 11, 10);
        store.reject('nope', { error: 'x' });
        expect(store.getSeq()).toBe(10);
        expect(store.getObject('a')?.properties.name).toBe('A');
    });

    /**
     * Проверяет, что прерванная локальная правка возвращает модель как была и ничего не ставит в очередь
     */
    it('abort_restoresModelAndQueuesNothing', () => {
        const store = loaded();
        const local = store.beginLocal();
        local.apply(rename('a', 'A', 'X'));
        local.apply({ op: 'delete', id: 'b' });
        local.abort();
        expect(store.getObject('a')?.properties.name).toBe('A');
        expect(store.getObject('b')).toBeDefined();
        expect(store.pending()).toEqual([]);
    });

    /**
     * Проверяет, что входящие изменения во время открытой локальной правки применяются после неё
     */
    it('applyRemote_duringLocalEdit_isDeferredUntilCommit', () => {
        const store = loaded();
        const local = store.beginLocal();
        local.apply(rename('a', 'A', 'X'));
        store.applyRemote({ toSeq: 11, changesetIds: ['x'], upserts: [], deletes: ['b'] });
        expect(store.getObject('b')).toBeDefined();
        local.commit([rename('a', 'A', 'X')]);
        expect(store.getObject('b')).toBeUndefined();
        expect(store.getObject('a')?.properties.name).toBe('X');
    });
});

/**
 * Хранилище клиента: адресные уведомления
 */
describe('dataStore: addressed notifications', () => {
    /**
     * Проверяет, что подписчик объекта и детей родителя узнают только о своих изменениях
     */
    it('notify_onlyAffectedObjectAndParentSubscribers', () => {
        const store = loaded();
        const calls: string[] = [];
        store.subscribeObject('a', () => calls.push('a'));
        store.subscribeObject('b', () => calls.push('b'));
        store.subscribeChildren('root', () => calls.push('root'));
        store.subscribeChildren(null, () => calls.push('top'));

        edit(store, [rename('a', 'A', 'X')]);

        expect(calls.sort()).toEqual(['a', 'root']);
    });

    /**
     * Проверяет, что перенос уведомляет и прежнего, и нового родителя
     */
    it('notify_move_notifiesOldAndNewParents', () => {
        const store = loaded();
        const calls: string[] = [];
        store.subscribeChildren('root', () => calls.push('root'));
        store.subscribeChildren(null, () => calls.push('top'));
        edit(store, [{ op: 'move', id: 'a', parent: { old: 'root', new: null } }]);
        expect(calls.sort()).toEqual(['root', 'top']);
    });

    /**
     * Проверяет, что подтверждение своего набора и переналожение очереди не уведомляют никого и не
     * меняют ссылки на неизменившиеся объекты и списки детей
     */
    it('notify_confirmAndRebase_keepIdentityOfUnchanged', () => {
        const store = loaded();
        edit(store, [rename('a', 'A', 'X')]);
        const a = store.getObject('a');
        const children = store.getChildren('root');
        const calls: string[] = [];
        store.subscribe((change) => calls.push(...change.ids));
        store.subscribeObject('a', () => calls.push('object a'));

        store.confirm('cs1', 11, 10);
        store.applyRemote({ toSeq: 12, changesetIds: ['x'], upserts: [], deletes: [] });

        expect(calls).toEqual([]);
        expect(store.getObject('a')).toBe(a);
        expect(store.getChildren('root')).toBe(children);
    });

    /**
     * Проверяет, что список детей неизменившегося родителя сохраняет ссылку после чужой правки
     */
    it('getChildren_unrelatedChange_keepsListIdentity', () => {
        const store = loaded();
        const top = store.getChildren(null);
        const inRoot = store.getChildren('root');
        edit(store, [rename('a', 'A', 'X')]);
        expect(store.getChildren(null)).toBe(top);
        expect(store.getChildren('root')).not.toBe(inRoot);
    });
});

/**
 * Полная загрузка поверх очереди и подписка на курсор
 */
describe('dataStore: reset and cursor', () => {
    /**
     * Проверяет, что полная загрузка сохраняет очередь и накладывает её на новый снимок
     */
    it('reset_withQueue_keepsQueueAndRebasesItOnSnapshot', async () => {
        const store = loaded();
        const { outcome } = edit(store, [rename('a', 'A', 'X')]);

        store.reset({
            seq: 20,
            types,
            objects: [
                { id: 'root', type: 'Folder', parent: null, number: 1, properties: {} },
                note('a', 'root', 'A2', 1),
                note('c', 'root', 'C', 3),
            ],
        });

        expect(store.getSeq()).toBe(20);
        expect(store.pending().map((c) => c.id)).toEqual(['cs1']);
        expect(store.getObject('a')?.properties.name).toBe('X');
        expect(store.getConfirmedObject('a')?.properties.name).toBe('A2');
        expect(store.getObject('b')).toBeUndefined();
        expect(store.getChildren('root').map((o) => o.id)).toEqual(['a', 'c']);
        store.confirm('cs1', 21, 20);
        await expect(outcome).resolves.toEqual({ ok: true });
    });

    /**
     * Проверяет, что набор, ставший невалидным после полной загрузки, убирается с уведомлением
     */
    it('reset_queuedChangesetBecomesInvalid_isDroppedWithNotice', async () => {
        const store = loaded();
        const notices: string[] = [];
        store.onNotice((message) => notices.push(message));
        const { outcome } = edit(store, [rename('b', 'B', 'X')]);

        store.reset({ seq: 20, types, objects: [note('a', null, 'A', 1)] });

        expect(store.pending()).toEqual([]);
        expect(store.getObject('b')).toBeUndefined();
        await expect(outcome).resolves.toMatchObject({ ok: false });
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatch(/^Изменение отменено после обновления данных/);
    });

    /**
     * Проверяет, что подписчики курсора узнают о каждом его сдвиге и только о нём
     */
    it('subscribeSeq_notifiedWhenCursorMoves', () => {
        const store = loaded();
        const seen: number[] = [];
        store.subscribeSeq(() => seen.push(store.getSeq()));
        edit(store, [rename('a', 'A', 'X')]);

        store.confirm('cs1', 11, 10);
        store.applyRemote({ toSeq: 11, changesetIds: [], upserts: [], deletes: [] });
        store.applyRemote({ toSeq: 15, changesetIds: ['x'], upserts: [], deletes: [] });
        store.reset({ seq: 30, types, objects: [] });

        expect(seen).toEqual([11, 15, 30]);
    });
});

const createN: Operation = {
    op: 'create',
    id: 'n',
    type: 'Note',
    parent: 'root',
    number: 3,
    properties: { name: 'N' },
};

/**
 * Восстановление сохранённой очереди (офлайн): наборы без локальной правки и без ожидающих итогов
 */
describe('dataStore: restored queue', () => {
    /**
     * Проверяет, что восстановленные наборы встают в очередь и видны в модели, а подписчики
     * очереди и объектов узнают об этом
     */
    it('restoreQueue_appendsChangesetsAndAppliesThemToVisibleModel', () => {
        const store = loaded();
        let pendingCalls = 0;
        let objectCalls = 0;
        store.subscribePending(() => pendingCalls++);
        store.subscribeObject('a', () => objectCalls++);

        store.restoreQueue([{ id: 'saved1', operations: [rename('a', 'A', 'X')] }]);

        expect(store.pending().map((c) => c.id)).toEqual(['saved1']);
        expect(store.getObject('a')?.properties.name).toBe('X');
        expect(store.getConfirmedObject('a')?.properties.name).toBe('A');
        expect(pendingCalls).toBe(1);
        expect(objectCalls).toBe(1);
    });

    /**
     * Проверяет, что уже стоящий в очереди набор с тем же id не дублируется
     */
    it('restoreQueue_knownId_isSkipped', () => {
        const store = loaded();
        edit(store, [rename('a', 'A', 'X')]);

        store.restoreQueue([
            { id: 'cs1', operations: [rename('a', 'A', 'X')] },
            { id: 'saved2', operations: [rename('b', 'B', 'Y')] },
        ]);

        expect(store.pending().map((c) => c.id)).toEqual(['cs1', 'saved2']);
    });

    /**
     * Проверяет, что восстановленный набор, неприменимый к подтверждённому слою (например, уже
     * применён на сервере, а снимок новее очереди), не отбрасывается без сервера: он ждёт итога
     * и уходит из очереди по подтверждению (`duplicate`), не трогая подтверждённый слой
     */
    it('restoreQueue_alreadyAppliedChangeset_waitsForServerInsteadOfBeingDropped', () => {
        const store = createDataStore();
        const notices: string[] = [];
        store.onNotice((m) => notices.push(m));
        // Снимок уже содержит созданную набором заметку `n` с более поздним именем (seq 11)
        store.reset({
            seq: 11,
            types,
            objects: [
                { id: 'root', type: 'Folder', parent: null, number: 1, properties: {} },
                note('n', 'root', 'Later', 3),
            ],
        });

        store.restoreQueue([{ id: 'saved1', operations: [createN] }]);

        expect(store.pending().map((c) => c.id)).toEqual(['saved1']);
        expect(notices).toEqual([]);
        // Видимая модель — подтверждённый слой: неприменимый набор не накладывается
        expect(store.getObject('n')?.properties.name).toBe('Later');

        store.confirm('saved1', 11, 10);

        expect(store.pending()).toEqual([]);
        expect(store.getConfirmedObject('n')?.properties.name).toBe('Later');
        expect(store.getSeq()).toBe(11);
        expect(notices).toEqual([]);
    });

    /**
     * Проверяет, что отказ сервера по восстановленному набору убирает его и зависимые с одним
     * сводным уведомлением
     */
    it('restoreQueue_rejectedByServer_dropsWithDependentsAndSingleNotice', () => {
        const store = loaded();
        const notices: string[] = [];
        store.onNotice((m) => notices.push(m));
        store.restoreQueue([
            { id: 'saved1', operations: [createN] },
            { id: 'saved2', operations: [rename('n', 'N', 'M')] },
        ]);
        expect(store.getObject('n')?.properties.name).toBe('M');

        store.reject('saved1', { error: 'Родитель не найден.' });

        expect(store.pending()).toEqual([]);
        expect(store.getObject('n')).toBeUndefined();
        expect(notices).toEqual(['Родитель не найден. Отменены также зависимые изменения: 1.']);
    });

    /**
     * Проверяет, что подтверждение набора, уже вошедшего в подтверждённое состояние (seq не больше
     * курсора), не накладывает его операции повторно поверх более поздних изменений
     */
    it('confirm_seqNotAfterCursor_doesNotReapplyOperations', () => {
        const store = loaded();
        edit(store, [rename('a', 'A', 'X')]);
        // Догон уже принёс более позднее значение (курсор 12), а свой набор (seq 11) в нём не узнан
        store.applyRemote({
            toSeq: 12,
            upserts: [note('a', 'root', 'Z', 1)],
            deletes: [],
            changesetIds: [],
        });

        store.confirm('cs1', 11, 10);

        expect(store.getConfirmedObject('a')?.properties.name).toBe('Z');
        expect(store.getObject('a')?.properties.name).toBe('Z');
    });

    /**
     * Проверяет снимок подтверждённого слоя для сохранения в кэш
     */
    it('confirmedSnapshot_returnsCursorTypesAndConfirmedObjects', () => {
        const store = loaded();
        edit(store, [rename('a', 'A', 'X')]);

        const snapshot = store.confirmedSnapshot();

        expect(snapshot.seq).toBe(10);
        expect(snapshot.types).toEqual(types);
        expect(snapshot.objects.find((o) => o.id === 'a')?.properties.name).toBe('A');
        expect(snapshot.objects).toHaveLength(3);
    });
});
