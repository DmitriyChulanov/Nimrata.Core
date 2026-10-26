import { safeUrl } from './safeUrl';

import type { DataController } from '../data/DataController';

/**
 * Подключает действие «Открыть внешнюю ссылку» (свойство `link`) к типам: переход в новой
 * вкладке без доступа к открывшей странице, только http и https
 *
 * @param data - контроллер данных
 * @param typeIds - типы, у которых есть свойство `link` и это действие
 * @returns функция отписки
 */
export function registerOpenExternalLink(data: DataController, typeIds: string[]): () => void {
    const disposers = typeIds.map((typeId) =>
        data.registerAction(
            typeId,
            'openExternalLink',
            ({ object }) => {
                const url = safeUrl(object.properties.link);
                if (!url) throw new Error('Ссылка должна начинаться с http:// или https://.');
                window.open(url, '_blank', 'noopener,noreferrer');
            },
            {
                available: (object) =>
                    typeof object.properties.link === 'string' && object.properties.link !== '',
            },
        ),
    );
    return () => disposers.forEach((dispose) => dispose());
}

/**
 * Подключает действие «Открыть внутреннюю ссылку» (свойство `internalLink`): показывает
 * объект-цель в дереве
 *
 * @param data - контроллер данных
 * @param typeId - тип, у которого есть свойство `internalLink` и это действие
 * @param reveal - показ объекта в дереве; без него действие только проверяет цель
 * @returns функция отписки
 */
export function registerOpenInternalLink(
    data: DataController,
    typeId: string,
    reveal: ((id: string) => void) | undefined,
): () => void {
    return data.registerAction(
        typeId,
        'openInternalLink',
        ({ object }) => {
            const target = object.properties.internalLink;
            if (typeof target !== 'string' || !data.getObject(target)) {
                throw new Error('Объект по ссылке недоступен.');
            }
            reveal?.(target);
        },
        {
            available: (object) =>
                typeof object.properties.internalLink === 'string' &&
                object.properties.internalLink !== '',
        },
    );
}
