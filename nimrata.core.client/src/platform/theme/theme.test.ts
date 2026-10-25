import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMenuRegistry } from '@platform/tabs/registries';

import { registerTheme } from './registerTheme';
import { applyThemeChoice, readThemeChoice, setThemeChoice } from './theme';

function mockSystemDark(dark: boolean) {
    vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
}

describe('theme', () => {
    beforeEach(() => {
        window.localStorage.clear();
        delete document.documentElement.dataset.theme;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('readThemeChoice_noStoredValue_returnsSystem', () => {
        expect(readThemeChoice()).toBe('system');
    });

    it('readThemeChoice_unknownStoredValue_returnsSystem', () => {
        window.localStorage.setItem('nimrata.theme', 'neon');

        expect(readThemeChoice()).toBe('system');
    });

    it('applyThemeChoice_systemWithDarkOs_setsDark', () => {
        mockSystemDark(true);

        applyThemeChoice('system');

        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('applyThemeChoice_lightWithDarkOs_setsLight', () => {
        mockSystemDark(true);

        applyThemeChoice('light');

        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('setThemeChoice_dark_storesAndApplies', () => {
        setThemeChoice('dark');

        expect(readThemeChoice()).toBe('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('registerTheme_registersThreeItemsUnderViewTheme', () => {
        const registry = createMenuRegistry();

        registerTheme(registry);

        expect(registry.listFor('member').map((item) => item.path)).toEqual([
            ['Вид', 'Тема', 'Системная'],
            ['Вид', 'Тема', 'Светлая'],
            ['Вид', 'Тема', 'Тёмная'],
        ]);
    });
});
