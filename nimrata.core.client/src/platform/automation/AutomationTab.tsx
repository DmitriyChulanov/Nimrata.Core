import { useActionLauncher } from '../actions/useActionLauncher';
import { useData } from '../data/DataProvider';
import type { DataController, DataObject } from '../data/DataController';

/** Все объекты типов с отметкой `automation` (включая скрытые в дереве), в порядке обхода. */
function collectMechanisms(data: DataController): DataObject[] {
    const result: DataObject[] = [];
    const walk = (parent: string | null) => {
        for (const object of data.getChildren(parent)) {
            if (data.getType(object.type)?.automation) result.push(object);
            walk(object.id);
        }
    };
    walk(null);
    return result;
}

/** Вкладка «Автоматизация»: механизмы и их действия с размещением `automation`. */
export function AutomationTab() {
    const data = useData();
    const launcher = useActionLauncher();
    const mechanisms = collectMechanisms(data);

    return (
        <div className="automation">
            {launcher.error && <p role="alert">{launcher.error}</p>}
            {mechanisms.length === 0 && <p>Механизмов нет.</p>}
            {mechanisms.map((object) => {
                const title =
                    (object.properties.name as string | undefined) ||
                    data.getType(object.type)?.name ||
                    object.type;
                return (
                    <section key={object.id} role="group" aria-label={title}>
                        <h3>{title}</h3>
                        {data.getActions(object.id, 'automation').map((action) => (
                            <button
                                key={action.id}
                                type="button"
                                onClick={() => void launcher.launch(object.id, action)}
                            >
                                {action.name}
                            </button>
                        ))}
                    </section>
                );
            })}
            {launcher.dialog}
        </div>
    );
}
