import { useApi } from '../auth/AuthProvider';
import { useData } from '../data/DataProvider';
import { useSelection } from '../selection/SelectionProvider';
import { useTypes } from '../types/TypesProvider';
import { JournalView } from './JournalView';
import type { JournalResolver } from './journal';

/** Вкладка «Журнал»: следит за выделением в дереве. */
export function JournalTab() {
    const api = useApi();
    const data = useData();
    const { getType } = useTypes();
    const { selectedId } = useSelection();

    // Resolver читает актуальную модель; useData перерисовывает вкладку при её изменении.
    const resolver: JournalResolver = {
        typeName: (id) => getType(id)?.name ?? id,
        propertyName: (typeId, id) =>
            (typeId ? getType(typeId)?.properties?.find((p) => p.id === id)?.name : undefined) ??
            id,
        objectLabel: (id) => {
            const object = data.getObject(id);
            if (!object) return null;
            const title = object.properties.title ?? object.properties.name;
            return typeof title === 'string' && title
                ? title
                : (getType(object.type)?.name ?? object.type);
        },
        objectTypeId: (id) => data.getObject(id)?.type ?? null,
    };

    return <JournalView api={api} selectedId={selectedId} resolver={resolver} />;
}
