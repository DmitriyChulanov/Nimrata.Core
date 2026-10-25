import { expect, it } from 'vitest';

import { createMenuRegistry, createTabRegistry } from './registries';

const stub = () => null;

it('tabRegistry_registeredKind_isReturnedById', () => {
    const tabs = createTabRegistry();
    tabs.register({ id: 'journal', title: 'Журнал', component: stub });

    expect(tabs.get('journal')?.title).toBe('Журнал');
    expect(tabs.get('missing')).toBeUndefined();
    expect(tabs.list().map((k) => k.id)).toEqual(['journal']);
});

it('tabRegistry_duplicateKindId_isRejected', () => {
    const tabs = createTabRegistry();
    tabs.register({ id: 'journal', title: 'Журнал', component: stub });

    expect(() => tabs.register({ id: 'journal', title: 'Другой', component: stub })).toThrow(
        /journal/,
    );
});

it('menuRegistry_itemsWithoutCondition_visibleToAllWithConditionOnlyToTheirRole', () => {
    const menu = createMenuRegistry();
    menu.register({ path: ['Вид', 'Журнал'], run: () => {} });
    menu.register({ path: ['Администрирование', 'Пользователи'], role: 'admin', run: () => {} });

    expect(menu.listFor('member').map((i) => i.path.join(' → '))).toEqual(['Вид → Журнал']);
    expect(menu.listFor('admin').map((i) => i.path.join(' → '))).toEqual([
        'Вид → Журнал',
        'Администрирование → Пользователи',
    ]);
});
