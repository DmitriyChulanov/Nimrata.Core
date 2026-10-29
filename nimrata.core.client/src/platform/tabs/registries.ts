import type { ComponentType } from 'react';

/**
 * Роль пользователя
 */
export type UserRole = 'admin' | 'member';

/**
 * Вид вкладки: что показывать и сколько копий можно открыть
 */
export interface TabKind {
    id: string;
    title: string;
    component: ComponentType;
    /** Разрешено ли открывать несколько копий; по умолчанию — одна */
    multiple?: boolean;
    /** Открывать ли вкладку при каждом запуске, если её нет в раскладке; по умолчанию — нет */
    openOnStart?: boolean;
}

/**
 * Реестр видов вкладок
 */
export interface TabRegistry {
    /** Регистрирует вид вкладки; повторная регистрация того же идентификатора — ошибка */
    register(kind: TabKind): void;
    /** Вид вкладки по идентификатору */
    get(id: string): TabKind | undefined;
    /** Все виды вкладок в порядке регистрации */
    list(): TabKind[];
}

/**
 * Контекст, который получает обработчик пункта меню
 */
export interface MenuContext {
    /** Открывает вкладку данного вида (для вида с одной копией переключает на существующую) */
    openTab(kindId: string): void;
}

/**
 * Пункт главного меню
 */
export interface MenuItem {
    /** Путь в меню, например `['Вид', 'Журнал']` */
    path: string[];
    /** Выполняет пункт */
    run(context: MenuContext): void;
    /** Если задана, пункт показывается только пользователям этой роли */
    role?: UserRole;
    /** Если задана и возвращает `false`, пункт показывается отключённым */
    enabled?: () => boolean;
    /** Подсказка с горячей клавишей (например, `Ctrl+Z`) */
    shortcut?: string;
    /** Подписка на изменение `enabled`; меню перерисуется. Возвращает отписку */
    subscribe?: (listener: () => void) => () => void;
}

/**
 * Реестр пунктов меню
 */
export interface MenuRegistry {
    /** Регистрирует пункт; возвращает функцию, снимающую регистрацию */
    register(item: MenuItem): () => void;
    /** Пункты, доступные роли, в порядке регистрации */
    listFor(role: UserRole): MenuItem[];
    /** Подписка на добавление и снятие пунктов */
    subscribe(listener: () => void): () => void;
}

/**
 * Создаёт пустой реестр видов вкладок
 *
 * @returns реестр
 */
export function createTabRegistry(): TabRegistry {
    const kinds = new Map<string, TabKind>();
    return {
        register(kind) {
            if (kinds.has(kind.id))
                throw new Error(`Вид вкладки «${kind.id}» уже зарегистрирован.`);
            kinds.set(kind.id, kind);
        },
        get: (id) => kinds.get(id),
        list: () => [...kinds.values()],
    };
}

/**
 * Создаёт пустой реестр пунктов меню
 *
 * @returns реестр
 */
export function createMenuRegistry(): MenuRegistry {
    const items: MenuItem[] = [];
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((l) => l());
    return {
        register(item) {
            items.push(item);
            notify();
            return () => {
                const index = items.indexOf(item);
                if (index >= 0) items.splice(index, 1);
                notify();
            };
        },
        listFor: (role) => items.filter((item) => !item.role || item.role === role),
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

/**
 * Реестры платформы: расширения регистрируют в них свои виды вкладок и пункты меню
 */
export const tabRegistry = createTabRegistry();
/**
 * Общий реестр пунктов меню платформы
 */
export const menuRegistry = createMenuRegistry();
