import type { ComponentType } from 'react';

import type { ChangeResult, DataController } from '../data/DataController';

/**
 * Связь логики расширения с интерфейсом платформы
 */
export interface ExtensionOptions {
    /** Показывает объект в дереве (выделяет и раскрывает родителей) */
    reveal?: (id: string) => void;
}

/**
 * Свойства компонента-привязки расширения
 */
export interface ExtensionBindingProps {
    /** Идентификатор вошедшего пользователя */
    userId: string;
}

/**
 * Клиентский дескриптор расширения: всё, что платформа знает о расширении
 */
export interface ExtensionDescriptor {
    /** Идентификатор расширения (совпадает с `extension` в манифесте) */
    id: string;
    /** Подключает хуки и действия расширения к контроллеру данных; возвращает функцию отписки */
    register(data: DataController, options: ExtensionOptions): () => void;
    /**
     * Создаёт стартовую структуру расширения и достраивает пропущенное. Идемпотентна: создаёт
     * только объекты расширения, которых ещё нет, и ничего не дублирует при повторном вызове
     */
    ensureStart(data: DataController): Promise<ChangeResult>;
    /** Необязательные компоненты, живущие внутри провайдеров данных и выделения (уведомления и т. п.) */
    bindings?: ComponentType<ExtensionBindingProps>[];
}

/**
 * Реестр дескрипторов расширений
 */
export interface ExtensionRegistry {
    /** Добавляет дескриптор (с тем же `id` — заменяет); возвращает функцию отписки */
    register(descriptor: ExtensionDescriptor): () => void;
    /** Зарегистрированные расширения в порядке регистрации */
    list(): ExtensionDescriptor[];
}

/**
 * Создаёт пустой реестр расширений
 *
 * @returns реестр без расширений
 */
export function createExtensionRegistry(): ExtensionRegistry {
    const items = new Map<string, ExtensionDescriptor>();
    return {
        register(descriptor) {
            items.set(descriptor.id, descriptor);
            return () => {
                if (items.get(descriptor.id) === descriptor) items.delete(descriptor.id);
            };
        },
        list: () => [...items.values()],
    };
}

/**
 * Общий реестр расширений приложения
 */
export const extensionRegistry = createExtensionRegistry();
