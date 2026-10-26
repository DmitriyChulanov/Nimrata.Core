import { createContext } from 'react';

import type { ChangeResult } from '@platform/data/DataController';
import type { ExtensionInfo } from '@platform/extensionCatalog/catalog';

/**
 * Состояние загрузки каталога и первичного запуска расширений
 */
export type ExtensionsStatus = 'loading' | 'ready' | 'error';

/**
 * Значение контекста расширений: каталог сервера и переключение подключений
 */
export interface ExtensionsValue {
    /** `loading` — идёт загрузка каталога и данных; `error` — каталог не загрузился (см. `error`, `reload`) */
    status: ExtensionsStatus;
    /** Последняя ошибка загрузки каталога, переключения или запуска расширения; `null`, если её нет */
    error: string | null;
    /** Каталог расширений с действующим состоянием подключений; пуст, пока не загружен */
    extensions: ExtensionInfo[];
    /** Идентификатор расширения, которое переключается прямо сейчас; `null` — переключения нет */
    switchingId: string | null;
    /**
     * Подключает или отключает расширение без перезагрузки страницы: сохраняет состояние на
     * сервере, снимает или регистрирует хуки и действия, перезагружает данные (очищает Undo/Redo),
     * сбрасывает выделение недоступного объекта, а для включаемого расширения вызывает
     * `ensureStart`. Параллельное переключение отклоняется; повтор текущего состояния ничего
     * не делает. Причина отказа возвращается и попадает в `error`
     */
    setConnected(id: string, connected: boolean): Promise<ChangeResult>;
    /** Повторно загружает каталог и данные (после ошибки каталога) */
    reload(): Promise<void>;
}

/**
 * Контекст расширений; `null` вне `ExtensionsProvider`
 */
export const ExtensionsContext = createContext<ExtensionsValue | null>(null);
