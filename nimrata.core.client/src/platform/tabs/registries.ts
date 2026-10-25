import type { ComponentType } from 'react';

/** Роль пользователя */
export type UserRole = 'admin' | 'member';

/** Вид вкладки: что показывать и сколько копий можно открыть */
export interface TabKind {
    id: string;
    title: string;
    component: ComponentType;
    /** Разрешено ли открывать несколько копий; по умолчанию — одна */
    multiple?: boolean;
}

export interface TabRegistry {
    register(kind: TabKind): void;
    get(id: string): TabKind | undefined;
    list(): TabKind[];
}

/** Контекст, который получает обработчик пункта меню */
export interface MenuContext {
    /** Открывает вкладку данного вида (для вида с одной копией переключает на существующую) */
    openTab(kindId: string): void;
}

export interface MenuItem {
    /** Путь в меню, например `['Вид', 'Журнал']` */
    path: string[];
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

export interface MenuRegistry {
    /** Регистрирует пункт; возвращает функцию, снимающую регистрацию */
    register(item: MenuItem): () => void;
    /** Пункты, доступные роли, в порядке регистрации */
    listFor(role: UserRole): MenuItem[];
    /** Подписка на добавление и снятие пунктов */
    subscribe(listener: () => void): () => void;
}

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

/** Реестры платформы: модули регистрируют в них свои виды вкладок и пункты меню */
export const tabRegistry = createTabRegistry();
export const menuRegistry = createMenuRegistry();
