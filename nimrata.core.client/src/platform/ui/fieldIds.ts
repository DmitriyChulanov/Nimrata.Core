import { useId } from 'react';

/**
 * Идентификаторы связанных элементов поля формы
 */
export interface FieldIds {
    /** Идентификатор самого элемента ввода (для `htmlFor` подписи) */
    control: string;
    /** Идентификатор подсказки */
    hint: string;
    /** Идентификатор сообщения об ошибке */
    error: string;
}

/**
 * Создаёт стабильные идентификаторы элементов поля, чтобы связать подпись, подсказку и ошибку
 *
 * @param explicitId - явный идентификатор элемента ввода, если задан снаружи
 * @returns идентификаторы элемента ввода, подсказки и ошибки
 */
export function useFieldIds(explicitId: string | undefined): FieldIds {
    const generated = useId();
    const control = explicitId ?? generated;
    return { control, hint: `${control}-hint`, error: `${control}-error` };
}

/**
 * Собирает значение `aria-describedby` из присутствующих подсказки и ошибки
 *
 * @param ids - идентификаторы элементов поля
 * @param hasHint - есть ли подсказка
 * @param hasError - есть ли сообщение об ошибке
 * @returns строка идентификаторов либо `undefined`, если описывать нечем
 */
export function describedBy(
    ids: FieldIds,
    hasHint: boolean,
    hasError: boolean,
): string | undefined {
    const parts = [hasHint ? ids.hint : null, hasError ? ids.error : null].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Атрибуты элемента ввода, связывающие его с подсказкой и ошибкой
 *
 * @param ids - идентификаторы связанных элементов
 * @param messages - подсказка и ошибка поля
 * @returns атрибуты `id`, `aria-invalid` и `aria-describedby`
 */
export function controlAria(ids: FieldIds, messages: { hint?: string; error?: string }) {
    return {
        id: ids.control,
        'aria-invalid': messages.error ? (true as const) : undefined,
        'aria-describedby': describedBy(ids, Boolean(messages.hint), Boolean(messages.error)),
    };
}
