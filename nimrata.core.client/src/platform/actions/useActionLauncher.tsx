import { useState } from 'react';

import { useData } from '@platform/data/useData';

import { ActionDialog } from './ActionDialog';

import type { ReactNode } from 'react';
import type { ChangeResult } from '@platform/data/DataController';
import type { ActionDefinition, CommandDefinition } from '@platform/types/types';

/**
 * Результат хука `useActionLauncher`: запуск действий и команд и связанное с ним состояние
 */
export interface ActionLauncher {
    /**
     * Запускает действие над объектом: без параметров сразу, с параметрами — через диалог.
     * Отказ запуска без диалога попадает в `error`
     */
    launch(objectId: string, action: ActionDefinition): Promise<void>;
    /**
     * Запускает команду расширения: без параметров сразу, с параметрами — через тот же диалог, что и
     * у действий. С `savedParams` (пользовательская команда) диалога нет: команда запускается
     * сохранёнными значениями. Отказ запуска без диалога попадает в `error`
     */
    launchCommand(command: CommandDefinition, savedParams?: Record<string, unknown>): Promise<void>;
    /** Диалог параметров (или `null`): рисуется там, где вызвана хук-функция */
    dialog: ReactNode;
    /** Причина последнего отказа запуска без диалога */
    error: string | null;
    /** Сбрасывает сообщение об отказе */
    clearError(): void;
}

/**
 * Запуск, ожидающий ввода параметров в диалоге
 */
interface Pending {
    /** Название и параметры для диалога (форма совпадает с описанием действия) */
    subject: Pick<ActionDefinition, 'id' | 'name' | 'parameters'>;
    /** Запускает действие или команду с собранными значениями */
    run(params: Record<string, unknown>): Promise<ChangeResult>;
}

/**
 * Общий запуск действий и команд: кнопки таблицы свойств, пункты контекстного меню и панель
 * «Команды» делят один диалог параметров
 */
export function useActionLauncher(): ActionLauncher {
    const data = useData();
    const [pending, setPending] = useState<Pending | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function start(
        subject: Pending['subject'],
        run: Pending['run'],
        savedParams?: Record<string, unknown>,
    ) {
        setError(null);
        if (savedParams === undefined && (subject.parameters ?? []).length > 0) {
            setPending({ subject, run });
            return;
        }
        const result = await run(savedParams ?? {});
        if (!result.ok) setError(result.error);
    }

    const dialog = pending ? (
        <ActionDialog
            action={pending.subject}
            onCancel={() => setPending(null)}
            onSubmit={async (params) => {
                const result = await pending.run(params);
                if (result.ok) {
                    setPending(null);
                    return null;
                }
                return result.error;
            }}
        />
    ) : null;

    return {
        launch: (objectId, action) =>
            start(action, (params) => data.runAction(objectId, action.id, params)),
        launchCommand: (command, savedParams) =>
            start(command, (params) => data.runCommand(command, params), savedParams),
        dialog,
        error,
        clearError: () => setError(null),
    };
}
