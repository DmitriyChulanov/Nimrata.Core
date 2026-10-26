import { afterEach, expect, it, vi } from 'vitest';

import { loadLayout, saveLayout } from './layoutStorage';

import type { StoredLayout } from './layoutStorage';

const layout: StoredLayout = {
    tabs: [{ id: 'journal#1', kind: 'journal' }],
    activeId: 'journal#1',
    widths: { left: 300, right: 340 },
};

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

/**
 * Проверяет, что сохранённая раскладка восстанавливается для того же пользователя
 */
it('layoutStorage_savedLayout_isRestoredForSameUser', () => {
    saveLayout('u1', layout);

    expect(loadLayout('u1')).toEqual(layout);
});

/**
 * Проверяет, что раскладки разных пользователей не пересекаются
 */
it('layoutStorage_differentUsers_layoutsDoNotIntersect', () => {
    saveLayout('u1', layout);

    expect(loadLayout('u2')).toBeNull();
});

/**
 * Проверяет, что повреждённое содержимое даёт пустую раскладку
 */
it('layoutStorage_corruptedContent_givesEmptyLayout', () => {
    localStorage.setItem('nimrata.layout.u1', '{не json');
    expect(loadLayout('u1')).toBeNull();

    localStorage.setItem('nimrata.layout.u1', JSON.stringify({ tabs: 'нет', widths: 1 }));
    expect(loadLayout('u1')).toBeNull();
});

/**
 * Проверяет, что недоступное хранилище не бросает исключение
 */
it('layoutStorage_unavailableStorage_doesNotThrow', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('закрыто');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('закрыто');
    });

    expect(loadLayout('u1')).toBeNull();
    expect(() => saveLayout('u1', layout)).not.toThrow();
});
