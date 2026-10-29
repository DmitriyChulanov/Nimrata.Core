import { useCallback, useMemo, useState } from 'react';

import { SelectionContext } from '@platform/selection/SelectionContext';

import type { ReactNode } from 'react';
import type { SelectionValue } from '@platform/selection/SelectionContext';

/**
 * Выделение: группа и основной объект (всегда входит в группу)
 */
interface Selection {
    ids: readonly string[];
    primary: string | null;
}

const EMPTY: Selection = { ids: [], primary: null };

/**
 * Хранит выделенные в дереве объекты, чтобы остальные панели могли их читать
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
    const [selection, setState] = useState<Selection>(EMPTY);
    const [revealRequest, setRevealRequest] = useState<SelectionValue['revealRequest']>(null);
    const [nameEditRequest, setNameEditRequest] = useState<SelectionValue['nameEditRequest']>(null);

    const setSelection = useCallback((ids: readonly string[], primary?: string | null) => {
        const unique = [...new Set(ids)];
        const main = primary !== undefined && primary !== null ? primary : (unique[0] ?? null);
        setState(
            unique.length === 0
                ? EMPTY
                : {
                      ids: main !== null && !unique.includes(main) ? [...unique, main] : unique,
                      primary: main,
                  },
        );
    }, []);
    const select = useCallback(
        (id: string | null) => setSelection(id === null ? [] : [id], id),
        [setSelection],
    );
    const reveal = useCallback(
        (id: string, ids?: readonly string[]) => {
            setSelection(ids ?? [id], id);
            setRevealRequest((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
        },
        [setSelection],
    );
    const requestNameEdit = useCallback(
        (id: string) => setNameEditRequest((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 })),
        [],
    );
    const finishNameEdit = useCallback(() => setNameEditRequest(null), []);
    const value = useMemo(
        () => ({
            selectedId: selection.primary,
            selectedIds: selection.ids,
            select,
            setSelection,
            reveal,
            revealRequest,
            requestNameEdit,
            nameEditRequest,
            finishNameEdit,
        }),
        [
            selection,
            select,
            setSelection,
            reveal,
            revealRequest,
            requestNameEdit,
            nameEditRequest,
            finishNameEdit,
        ],
    );
    return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
