/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface SelectionValue {
    /** Выделенный в дереве объект; `null` — ничего не выделено. */
    selectedId: string | null;
    select(id: string | null): void;
    /** Выделяет объект и просит дерево раскрыть его родителей и показать узел. */
    reveal(id: string): void;
    /** Последний запрос на показ узла в дереве; `seq` растёт с каждым вызовом `reveal`. */
    revealRequest: { id: string; seq: number } | null;
}

const SelectionContext = createContext<SelectionValue | null>(null);

/** Хранит выделенный в дереве объект, чтобы остальные панели могли его читать. */
export function SelectionProvider({ children }: { children: ReactNode }) {
    const [selectedId, select] = useState<string | null>(null);
    const [revealRequest, setRevealRequest] = useState<SelectionValue['revealRequest']>(null);
    const reveal = useCallback((id: string) => {
        select(id);
        setRevealRequest((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
    }, []);
    const value = useMemo(
        () => ({ selectedId, select, reveal, revealRequest }),
        [selectedId, reveal, revealRequest],
    );
    return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionValue {
    const value = useContext(SelectionContext);
    if (!value) throw new Error('SelectionProvider не найден в дереве компонентов.');
    return value;
}
