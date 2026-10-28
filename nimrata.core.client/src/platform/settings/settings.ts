import { createNode } from '@platform/extensionApi/changes';

import type { ChangeScope, DataController, DataObject } from '@platform/data/DataController';

/**
 * Платформенный корень «Настройки» (singleton): в нём у каждого расширения свой узел настроек
 */
export const SETTINGS_ROOT = 'SettingsRoot';

/**
 * Порядок корня «Настройки» среди корней: после всех расширений
 */
const SETTINGS_ORDER = 1_000_000;

/**
 * Корень «Настройки» пользователя
 *
 * @param data - контроллер данных
 * @returns корень или `undefined`, если его ещё нет
 */
export function findSettingsRoot(data: DataController): DataObject | undefined {
    return data.getChildren(null).find((o) => o.type === SETTINGS_ROOT);
}

/**
 * Узел настроек расширения: потомок корня «Настройки» типа `typeId`
 *
 * @param data - контроллер данных
 * @param typeId - тип узла настроек, объявленный расширением
 * @returns узел или `undefined`, если его ещё нет
 */
export function findSettingsNode(data: DataController, typeId: string): DataObject | undefined {
    const root = findSettingsRoot(data);
    return root && data.getChildren(root.id).find((o) => o.type === typeId);
}

/**
 * Находит или создаёт корень «Настройки» и в нём узел настроек расширения типа `typeId`
 *
 * @param data - контроллер данных
 * @param tx - область изменений
 * @param typeId - тип узла настроек, объявленный расширением
 * @returns идентификатор узла настроек
 */
export function ensureSettingsNode(data: DataController, tx: ChangeScope, typeId: string): string {
    const rootId =
        findSettingsRoot(data)?.id ?? createNode(tx, null, SETTINGS_ROOT, {}, SETTINGS_ORDER);
    const existing = findSettingsNode(data, typeId);
    return existing?.id ?? createNode(tx, rootId, typeId);
}

/**
 * Запрещает удалять и переносить служебные узлы настроек: корень «Настройки» и узлы типов `typeIds`
 *
 * @param data - контроллер данных
 * @param typeIds - типы узлов, которые пользователь не должен удалять и переносить
 * @returns функция отписки
 */
export function registerSettingsGuard(data: DataController, typeIds: string[]): () => void {
    const disposers = [SETTINGS_ROOT, ...typeIds].flatMap((type) => [
        data.registerHook(type, 'remove', 'before', () => ({
            cancel: 'Служебный узел настроек удалить нельзя.',
        })),
        data.registerHook(type, 'move', 'before', () => ({
            cancel: 'Служебный узел настроек переносить нельзя.',
        })),
    ]);
    return () => disposers.forEach((dispose) => dispose());
}
