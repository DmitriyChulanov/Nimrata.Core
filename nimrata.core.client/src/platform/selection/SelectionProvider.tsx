/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface SelectionValue {
    /** Выделенный в дереве объект; `null` — ничего не выделено. */
    selectedId: string | null;
    select(id: string | null): void;
}

const SelectionContext = createContext<SelectionValue | null>(null);

/** Хранит выделенный в дереве объект, чтобы остальные панели могли его читать. */
export function SelectionProvider({ children }: { children: ReactNode }) {
    const [selectedId, select] = useState<string | null>(null);
    const value = useMemo(() => ({ selectedId, select }), [selectedId]);
    return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionValue {
    const value = useContext(SelectionContext);
    if (!value) throw new Error('SelectionProvider не найден в дереве компонентов.');
    return value;
}
