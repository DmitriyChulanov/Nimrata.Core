import { useState, useSyncExternalStore } from 'react';

import { useDataController } from '@platform/data/useDataController';

import type { DependencyList } from 'react';
import type { DataController, DataSnapshot } from '@platform/data/DataController';

/**
 * Поверхностное равенство: одно и то же значение либо массивы или простые объекты с теми же
 * элементами (по `Object.is`)
 *
 * @param a - прежний результат
 * @param b - новый результат
 * @returns `true`, если перерисовка не нужна
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
    }
    if (
        typeof a !== 'object' ||
        typeof b !== 'object' ||
        a === null ||
        b === null ||
        Array.isArray(a) ||
        Array.isArray(b)
    ) {
        return false;
    }
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    return (
        keys.length === Object.keys(right).length &&
        keys.every(
            (key) =>
                Object.prototype.hasOwnProperty.call(right, key) &&
                Object.is(left[key], right[key]),
        )
    );
}

/**
 * Совпадают ли списки зависимостей
 *
 * @param a - прежние зависимости
 * @param b - новые зависимости
 * @returns `true`, если все элементы равны по `Object.is`
 */
function sameDeps(a: DependencyList, b: DependencyList): boolean {
    return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

/**
 * Выборка из модели с кешем: пересчитывается при смене снимка контроллера или зависимостей,
 * а прежний результат сохраняется, если новый ему равен
 *
 * @template T - тип результата выборки
 */
interface Selection<T> {
    /** Запоминает актуальные контроллер, выборку, зависимости и равенство (каждую отрисовку) */
    update(
        data: DataController,
        selector: (data: DataController) => T,
        deps: DependencyList,
        isEqual: (a: T, b: T) => boolean,
    ): void;
    /** Текущий результат (стабильная ссылка для `useSyncExternalStore`) */
    read(): T;
}

/**
 * Создаёт пустую выборку
 *
 * @template T - тип результата выборки
 * @returns выборка без результата
 */
function createSelection<T>(): Selection<T> {
    let data: DataController | null = null;
    let selector: ((data: DataController) => T) | null = null;
    let isEqual: (a: T, b: T) => boolean = Object.is;
    let deps: DependencyList | null = null;
    let seen: DataSnapshot | null = null;
    let dirty = true;
    let result: { value: T } | null = null;
    return {
        update(nextData, nextSelector, nextDeps, nextIsEqual) {
            selector = nextSelector;
            isEqual = nextIsEqual;
            if (nextData !== data || !deps || !sameDeps(deps, nextDeps)) {
                data = nextData;
                deps = nextDeps;
                dirty = true;
            }
        },
        read() {
            if (!data || !selector) throw new Error('Выборка не инициализирована.');
            const current = data.getSnapshot();
            if (!dirty && current === seen && result) return result.value;
            const next = selector(data);
            seen = current;
            dirty = false;
            if (!result || !isEqual(result.value, next)) result = { value: next };
            return result.value;
        },
    };
}

/**
 * Производное значение модели; компонент перерисовывается, только когда результат выборки
 * меняется (по `isEqual`, по умолчанию поверхностно). Выборка пересчитывается при каждом
 * изменении модели и при смене `deps`
 *
 * @template T - тип результата выборки
 * @param selector - чистая функция от контроллера данных
 * @param deps - значения, от которых зависит выборка помимо модели
 * @param isEqual - равенство результатов; по умолчанию `shallowEqual`
 * @returns результат выборки
 */
export function useQuery<T>(
    selector: (data: DataController) => T,
    deps: DependencyList,
    isEqual: (a: T, b: T) => boolean = shallowEqual,
): T {
    const data = useDataController();
    const [selection] = useState(createSelection<T>);
    selection.update(data, selector, deps, isEqual);
    return useSyncExternalStore(data.subscribe, selection.read);
}
