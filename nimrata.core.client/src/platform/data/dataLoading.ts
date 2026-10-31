/**
 * Загрузка модели контроллера данных: полная загрузка с сервера и старт из офлайн-кэша. Обе
 * заменяют подтверждённый слой хранилища и очищают стек отмены
 */
import { errorMessage } from './errorMessage';

import type { DataController, DataSnapshot, SyncLink } from './DataController';
import type { DataStore } from './dataStore';
import type { UndoHistory } from './undoHistory';

/**
 * Что нужно загрузке от контроллера
 */
export interface DataLoadingOptions {
    /** Хранилище: замена подтверждённого слоя снимком */
    store: Pick<DataStore, 'reset'>;
    /** Сетевая часть: полная загрузка с сервера */
    link: Pick<SyncLink, 'resync'>;
    /** Стек отмены: после загрузки прежние действия отменять нельзя */
    history: Pick<UndoHistory, 'clear'>;
    /**
     * Обновляет снимок состояния контроллера и уведомляет подписчиков
     *
     * @param patch - изменённые поля снимка
     * @param model - изменилась ли модель (растёт версия)
     */
    publish(patch: Partial<DataSnapshot>, model?: boolean): void;
}

/**
 * Создаёт загрузку модели
 *
 * @param options - хранилище, сетевая часть, стек отмены и публикация состояния
 * @returns `load` и `startFromCache` для контроллера
 */
export function createDataLoading(
    options: DataLoadingOptions,
): Pick<DataController, 'load' | 'startFromCache'> {
    const { store, link, history, publish } = options;
    return {
        async load() {
            publish({ status: 'loading', error: null }, false);
            try {
                await link.resync();
                history.clear();
                publish({ status: 'ready', error: null });
            } catch (error) {
                publish({ status: 'error', error: errorMessage(error) }, false);
            }
        },
        startFromCache(cache) {
            // Офлайн-старт: модель из кэша IndexedDB сразу, сервер догонят позже
            store.reset(cache);
            history.clear();
            publish({ status: 'ready', error: null });
        },
    };
}
