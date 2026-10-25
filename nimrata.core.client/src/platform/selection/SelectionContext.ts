import { createContext } from 'react';

export interface SelectionValue {
    /** Выделенный в дереве объект; `null` — ничего не выделено */
    selectedId: string | null;
    select(id: string | null): void;
    /** Выделяет объект и просит дерево раскрыть его родителей и показать узел */
    reveal(id: string): void;
    /** Последний запрос на показ узла в дереве; `seq` растёт с каждым вызовом `reveal` */
    revealRequest: { id: string; seq: number } | null;
}

export const SelectionContext = createContext<SelectionValue | null>(null);
