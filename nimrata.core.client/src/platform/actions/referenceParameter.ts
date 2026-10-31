import { ancestors } from '@platform/objectQueries/objectQueries';
import { visibleChildren } from '@platform/tree/treeModel';

import type { DataController, DataObject } from '@platform/data/DataController';
import type { PropertyDefinition } from '@platform/types/types';

/**
 * Префикс ключей запомненного выбора в `localStorage`
 */
const STORAGE_PREFIX = 'nimrata:lastChoice:';

/**
 * Первый объект типа `typeId` в порядке обхода дерева вглубь; `undefined`, если такого нет
 */
function findByType(data: DataController, typeId: string): DataObject | undefined {
    const walk = (parent: string | null): DataObject | undefined => {
        for (const { object } of visibleChildren(data, parent)) {
            if (object.type === typeId) return object;
            const found = walk(object.id);
            if (found) return found;
        }
    };
    return walk(null);
}

/**
 * Родитель, чьи потомки образуют дерево выбора ссылочного параметра
 *
 * @param data - контроллер данных
 * @param parameter - параметр действия
 * @returns идентификатор корня выбора; `null` — всё дерево; `undefined` — корень задан типом, но
 * объекта этого типа нет
 */
export function referenceRoot(
    data: DataController,
    parameter: PropertyDefinition,
): string | null | undefined {
    if (!parameter.targetRootType) return null;
    return findByType(data, parameter.targetRootType)?.id;
}

/**
 * Можно ли выбрать объект в ссылочном параметре: тип из `targetTypes` и потомок корня выбора
 *
 * @param data - контроллер данных
 * @param parameter - параметр действия
 * @param root - корень выбора, результат `referenceRoot`
 * @param object - проверяемый объект
 * @returns `true`, если объект допустим
 */
export function isReferenceAllowed(
    data: DataController,
    parameter: PropertyDefinition,
    root: string | null,
    object: DataObject,
): boolean {
    if (parameter.targetTypes && !parameter.targetTypes.includes(object.type)) return false;
    return root === null || ancestors(data, object).some((a) => a.id === root);
}

/**
 * Есть ли в дереве выбора хотя бы один допустимый объект
 */
export function hasReferenceChoices(
    data: DataController,
    parameter: PropertyDefinition,
    root: string | null,
): boolean {
    const walk = (parent: string | null): boolean =>
        visibleChildren(data, parent).some(
            ({ object }) => isReferenceAllowed(data, parameter, root, object) || walk(object.id),
        );
    return walk(root);
}

/**
 * Запомненный последний выбор; `null`, если его нет или хранилище недоступно
 *
 * @param key - ключ вида «действие:параметр»
 */
export function readLastChoice(key: string): string | null {
    try {
        return localStorage.getItem(STORAGE_PREFIX + key);
    } catch {
        return null;
    }
}

/**
 * Запоминает последний выбор в этом браузере; недоступное хранилище не считается ошибкой
 *
 * @param key - ключ вида «действие:параметр»
 * @param value - идентификатор выбранного объекта
 */
export function writeLastChoice(key: string, value: string): void {
    try {
        localStorage.setItem(STORAGE_PREFIX + key, value);
    } catch {
        // Запоминание выбора — удобство: без хранилища оно просто не работает
    }
}
