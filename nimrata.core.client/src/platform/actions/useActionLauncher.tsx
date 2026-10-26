import { useState } from 'react';

import { useData } from '@platform/data/useData';

import { ActionDialog } from './ActionDialog';

import type { ReactNode } from 'react';
import type { ActionDefinition } from '@platform/types/types';

/**
 * Результат хука `useActionLauncher`: запуск действий и связанное с ним состояние
 */
export interface ActionLauncher {
    /**
     * Запускает действие над объектом: без параметров сразу, с параметрами — через диалог.
     * Отказ запуска без диалога попадает в `error`
     */
    launch(objectId: string, action: ActionDefinition): Promise<void>;
    /** Диалог параметров (или `null`): рисуется там, где вызвана хук-функция */
    dialog: ReactNode;
    /** Причина последнего отказа запуска без диалога */
    error: string | null;
    /** Сбрасывает сообщение об отказе */
    clearError(): void;
}

/**
 * Общий запуск действий для кнопок таблицы свойств и пунктов контекстного меню
 */
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
