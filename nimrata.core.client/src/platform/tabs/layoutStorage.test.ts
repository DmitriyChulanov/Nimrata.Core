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

it('layoutStorage_savedLayout_isRestoredForSameUser', () => {
    saveLayout('u1', layout);

    expect(loadLayout('u1')).toEqual(layout);
});

it('layoutStorage_differentUsers_layoutsDoNotIntersect', () => {
    saveLayout('u1', layout);

    expect(loadLayout('u2')).toBeNull();
});

it('layoutStorage_corruptedContent_givesEmptyLayout', () => {
    localStorage.setItem('nimrata.layout.u1', '{не json');
    expect(loadLayout('u1')).toBeNull();

    localStorage.setItem('nimrata.layout.u1', JSON.stringify({ tabs: 'нет', widths: 1 }));
    expect(loadLayout('u1')).toBeNull();
});

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
