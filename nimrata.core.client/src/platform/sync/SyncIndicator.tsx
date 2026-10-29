import { Button, Tooltip } from '@platform/ui';

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
    if (!status) return null;
    const view = describeSyncStatus(status);

    return (
        <Tooltip
            className={`sync-indicator sync-indicator--${view.kind}`}
            content={`${view.detail} Нажмите, чтобы синхронизировать сейчас.`}
        >
            {(tooltipId) => (
                <Button
                    variant="ghost"
                    icon={view.icon}
                    className="sync-indicator__button"
                    aria-describedby={tooltipId}
                    onClick={status.syncNow}
                >
                    {view.label}
                </Button>
            )}
        </Tooltip>
    );
}
