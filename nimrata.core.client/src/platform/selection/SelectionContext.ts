import { createContext } from 'react';

/**
 * Значение контекста выделения объекта в дереве
 */
export interface SelectionValue {
    /** Выделенный в дереве объект; `null` — ничего не выделено */
    selectedId: string | null;
    /** Выделяет объект; `null` снимает выделение */
    select(id: string | null): void;
    /** Выделяет объект и просит дерево раскрыть его родителей и показать узел */
    reveal(id: string): void;
    /** Последний запрос на показ узла в дереве; `seq` растёт с каждым вызовом `reveal` */
    revealRequest: { id: string; seq: number } | null;
}

/**
 * Контекст выделения; `null` вне `SelectionProvider`
 */
export const SelectionContext = createContext<SelectionValue | null>(null);
