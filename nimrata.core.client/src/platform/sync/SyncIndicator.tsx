import { useId } from 'react';

import { Button } from '@platform/ui';

import { describeSyncStatus } from './syncStatus';
import { useSyncStatus } from './useSyncStatus';
import './SyncIndicator.css';

/**
 * Компактный индикатор синхронизации для шапки: «Синхронизировано», «N неотправленных»,
 * «Офлайн» или «Ошибка»; подробности — в подсказке при наведении и фокусе (она же описание
 * кнопки для скринридера). Нажатие синхронизирует сейчас. Предупреждения при закрытии вкладки
 * нет: очередь переживает перезагрузку
 *
 * @returns кнопка-индикатор с подсказкой; ничего вне `SyncStatusProvider`
 */
export function SyncIndicator() {
    const status = useSyncStatus();
    const tipId = useId();
    if (!status) return null;
    const view = describeSyncStatus(status);

    return (
        <span className={`sync-indicator sync-indicator--${view.kind}`}>
            <Button
                variant="ghost"
                icon={view.icon}
                className="sync-indicator__button"
                aria-describedby={tipId}
                onClick={status.syncNow}
            >
                {view.label}
            </Button>
            <span role="tooltip" id={tipId} className="sync-indicator__tip">
                {view.detail} Нажмите, чтобы синхронизировать сейчас.
            </span>
        </span>
    );
}
