import { createContext } from 'react';

/**
 * Значение контекста выделения объектов в дереве
 */
export interface SelectionValue {
    /** Основной выделенный объект (последний выбранный, его свойства показывает таблица); `null` — ничего не выделено */
    selectedId: string | null;
    /** Все выделенные объекты, включая основной; пусто, если ничего не выделено */
    selectedIds: readonly string[];
    /** Выделяет один объект; `null` снимает выделение */
    select(id: string | null): void;
    /** Выделяет группу объектов; `primary` — основной (по умолчанию первый из группы) */
    setSelection(ids: readonly string[], primary?: string | null): void;
    /**
     * Выделяет объект (или группу `ids` с основным `id`) и просит дерево раскрыть родителей
     * основного объекта и показать его
     */
    reveal(id: string, ids?: readonly string[]): void;
    /** Последний запрос на показ узла в дереве; `seq` растёт с каждым вызовом `reveal` */
    revealRequest: { id: string; seq: number } | null;
    /** Просит таблицу свойств перевести фокус на редактируемое «Имя» объекта `id` (после создания) */
    requestNameEdit(id: string): void;
    /** Невыполненный запрос на правку «Имени»; `seq` растёт с каждым вызовом `requestNameEdit` */
    nameEditRequest: { id: string; seq: number } | null;
    /** Сообщает, что запрос на правку «Имени» выполнен: таблица свойств больше не будет брать фокус */
    finishNameEdit(): void;
}

/**
 * Контекст выделения; `null` вне `SelectionProvider`
 */
export const SelectionContext = createContext<SelectionValue | null>(null);
