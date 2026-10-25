import { useActionLauncher } from '@platform/actions/useActionLauncher';
import { useData } from '@platform/data/useData';
import { useOptionalSelection } from '@platform/selection/useOptionalSelection';

import type { DataController, DataObject } from '@platform/data/DataController';

/** Все объекты типов с отметкой `automation` (включая скрытые в дереве), в порядке обхода */
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

/** Цель механизма: значение ссылочного свойства с признаком `revealTarget`, если объект существует */
function revealTargetOf(data: DataController, object: DataObject): string | undefined {
    const property = data
        .getType(object.type)
        ?.properties?.find((p) => p.kind === 'reference' && p.revealTarget);
    const value = property ? object.properties[property.id] : undefined;
    return typeof value === 'string' && data.getObject(value) ? value : undefined;
}

/** Вкладка «Автоматизация»: механизмы и их действия с размещением `automation` */
export function AutomationTab() {
    const data = useData();
    const selection = useOptionalSelection();
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
                // Механизм со ссылочным свойством revealTarget: клик по названию выделяет цель
                // в основном дереве
                const targetId = revealTargetOf(data, object);
                return (
                    <section key={object.id} role="group" aria-label={title}>
                        <h3>
                            {targetId && selection ? (
                                <button type="button" onClick={() => selection.reveal(targetId)}>
                                    {title}
                                </button>
                            ) : (
                                title
                            )}
                        </h3>
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
