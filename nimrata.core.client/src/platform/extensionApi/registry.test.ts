import { describe, expect, it } from 'vitest';

import { createExtensionRegistry } from './registry';

import type { ExtensionDescriptor } from './registry';

function descriptor(id: string): ExtensionDescriptor {
    return {
        id,
        register: () => () => undefined,
        ensureStart: () => Promise.resolve({ ok: true }),
    };
}

/**
 * Реестр дескрипторов расширений
 */
describe('extensionRegistry', () => {
    /**
     * Проверяет, что расширения перечисляются в порядке регистрации
     */
    it('list_registeredExtensions_returnsThemInRegistrationOrder', () => {
        const registry = createExtensionRegistry();
        registry.register(descriptor('tasks'));
        registry.register(descriptor('notes'));

        expect(registry.list().map((e) => e.id)).toEqual(['tasks', 'notes']);
    });

    /**
     * Проверяет, что повторная регистрация того же идентификатора заменяет дескриптор, а не дублирует
     */
    it('register_sameIdTwice_replacesDescriptor', () => {
        const registry = createExtensionRegistry();
        const second = descriptor('tasks');
        registry.register(descriptor('tasks'));
        registry.register(second);

        expect(registry.list()).toEqual([second]);
    });

    /**
     * Проверяет, что функция отписки убирает расширение
     */
    it('register_returnedDisposer_removesExtension', () => {
        const registry = createExtensionRegistry();
        const dispose = registry.register(descriptor('tasks'));

        dispose();

        expect(registry.list()).toEqual([]);
    });
});
