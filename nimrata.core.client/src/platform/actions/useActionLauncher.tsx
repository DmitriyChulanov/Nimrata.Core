import { useState } from 'react';
import type { ReactNode } from 'react';

import { useData } from '../data/DataProvider';
import type { ActionDefinition } from '../types/types';
import { ActionDialog } from './ActionDialog';

export interface ActionLauncher {
    /**
     * Запускает действие над объектом: без параметров сразу, с параметрами — через диалог.
     * Отказ запуска без диалога попадает в `error`.
     */
    launch(objectId: string, action: ActionDefinition): Promise<void>;
    /** Диалог параметров (или `null`): рисуется там, где вызвана хук-функция. */
    dialog: ReactNode;
    /** Причина последнего отказа запуска без диалога. */
    error: string | null;
    clearError(): void;
}

/** Общий запуск действий для кнопок таблицы свойств и пунктов контекстного меню. */
export function useActionLauncher(): ActionLauncher {
    const data = useData();
    const [pending, setPending] = useState<{ objectId: string; action: ActionDefinition } | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);

    async function launch(objectId: string, action: ActionDefinition) {
        setError(null);
        if ((action.parameters ?? []).length > 0) {
            setPending({ objectId, action });
            return;
        }
        const result = await data.runAction(objectId, action.id);
        if (!result.ok) setError(result.error);
    }

    const dialog = pending ? (
        <ActionDialog
            action={pending.action}
            onCancel={() => setPending(null)}
            onSubmit={async (params) => {
                const result = await data.runAction(pending.objectId, pending.action.id, params);
                if (result.ok) {
                    setPending(null);
                    return null;
                }
                return result.error;
            }}
        />
    ) : null;

    return { launch, dialog, error, clearError: () => setError(null) };
}
