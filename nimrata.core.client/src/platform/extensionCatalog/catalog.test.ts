import { describe, expect, it } from 'vitest';

import { isExtensionCatalog } from './catalog';

import type { ExtensionInfo } from './catalog';

const tasks: ExtensionInfo = {
    id: 'tasks',
    name: 'Трекер',
    description: 'Задачи',
    icon: 'check',
    defaultEnabled: true,
    connected: true,
    commands: [{ id: 'tasks.new', name: 'Новая задача', icon: 'plus' }],
};

/**
 * Проверка формы каталога расширений, прочитанного из кэша IndexedDB
 */
describe('isExtensionCatalog', () => {
    /**
     * Проверяет, что каталог верной формы (и пустой) принимается
     */
    it('isExtensionCatalog_validOrEmpty_true', () => {
        expect(isExtensionCatalog([tasks])).toBe(true);
        expect(isExtensionCatalog([])).toBe(true);
    });

    /**
     * Проверяет, что значение неверной формы (старая версия кэша, порча базы) не принимается
     */
    it('isExtensionCatalog_invalid_false', () => {
        expect(isExtensionCatalog(undefined)).toBe(false);
        expect(isExtensionCatalog({ items: [tasks] })).toBe(false);
        expect(isExtensionCatalog([{ id: 'tasks', connected: true }])).toBe(false);
        expect(isExtensionCatalog([{ ...tasks, commands: undefined }])).toBe(false);
        expect(isExtensionCatalog([{ ...tasks, commands: [{ id: 'x' }] }])).toBe(false);
    });
});
