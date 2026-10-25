import { useCallback, useMemo, useState } from 'react';

import { SelectionContext } from '@platform/selection/SelectionContext';

import type { ReactNode } from 'react';
import type { SelectionValue } from '@platform/selection/SelectionContext';

/** Хранит выделенный в дереве объект, чтобы остальные панели могли его читать */
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
