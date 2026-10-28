import { useApi } from '@platform/auth/useApi';
import { useData } from '@platform/data/useData';
import { objectLabel } from '@platform/objectQueries/objectQueries';
import { useSelection } from '@platform/selection/useSelection';
import { useTypes } from '@platform/types/useTypes';

import { JournalView } from './JournalView';

import type { JournalResolver } from './journal';

/**
 * Вкладка «Журнал»: следит за выделением в дереве
 */
export function JournalTab() {
    const api = useApi();
    const data = useData();
    const { getType } = useTypes();
    const { selectedId } = useSelection();

    // Resolver читает актуальную модель; useData перерисовывает вкладку при её изменении
    const resolver: JournalResolver = {
        typeName: (id) => getType(id)?.name ?? id,
        propertyName: (typeId, id) =>
            (typeId ? getType(typeId)?.properties?.find((p) => p.id === id)?.name : undefined) ??
            id,
        objectLabel: (id) => {
            const object = data.getObject(id);
            if (!object) return null;
            return objectLabel({ getObject: data.getObject, getType }, object);
        },
        objectTypeId: (id) => data.getObject(id)?.type ?? null,
    };

    return <JournalView api={api} selectedId={selectedId} resolver={resolver} />;
}
