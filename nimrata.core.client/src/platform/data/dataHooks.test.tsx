import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createDataController } from './DataController';
import { DataProvider } from './DataProvider';
import { createFakeApi } from './fakeApi';
import { useChildren } from './useChildren';
import { useObject } from './useObject';
import { useQuery } from './useQuery';

import type { ReactNode } from 'react';

const types = [
    { id: 'Folder', name: 'Папка', extension: 't', extensionVersion: 1 },
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'name', name: 'Имя', kind: 'string' }],
    },
];
const objects = [
    { id: 'root', type: 'Folder', parent: null, number: 1, properties: {} },
    { id: 'other', type: 'Folder', parent: null, number: 2, properties: {} },
    { id: 'a', type: 'Note', parent: 'root', number: 1, properties: { name: 'A' } },
    { id: 'b', type: 'Note', parent: 'root', number: 2, properties: { name: 'B' } },
    { id: 'c', type: 'Note', parent: 'other', number: 1, properties: { name: 'C' } },
];

async function setup(children: ReactNode) {
    const data = createDataController({ api: createFakeApi(types, structuredClone(objects)) });
    await data.load();
    render(<DataProvider controller={data}>{children}</DataProvider>);
    return data;
}

const renders = new Map<string, number>();
const count = (key: string) => renders.set(key, (renders.get(key) ?? 0) + 1);

/**
 * Имя объекта; считает свои отрисовки
 */
function Name({ id }: { id: string }) {
    const object = useObject(id);
    count(`object:${id}`);
    return <span>{String(object?.properties.name ?? '—')}</span>;
}

/**
 * Список детей родителя; считает свои отрисовки
 */
function Children({ parent }: { parent: string }) {
    const children = useChildren(parent);
    count(`children:${parent}`);
    return <span>{children.map((o) => o.id).join(',')}</span>;
}

/**
 * Число заметок в модели; считает свои отрисовки
 */
function NoteCount() {
    const total = useQuery(
        (data) => [...data.getChildren('root'), ...data.getChildren('other')].length,
        [],
    );
    count('query');
    return <span>{`Всего: ${total}`}</span>;
}

/**
 * Адресные подписки на данные: перерисовываются только затронутые компоненты
 */
describe('data hooks: addressed subscriptions', () => {
    /**
     * Проверяет, что правка объекта перерисовывает его подписчика и список детей его родителя,
     * но не подписчиков других объектов и родителей и не запрос с неизменившимся результатом
     */
    it('change_rerendersOnlyAffectedSubscribers', async () => {
        renders.clear();
        const data = await setup(
            <>
                <Name id="a" />
                <Name id="b" />
                <Children parent="root" />
                <Children parent="other" />
                <NoteCount />
            </>,
        );
        const before = new Map(renders);

        await act(() => data.setProperty('a', 'name', 'A2'));

        expect(screen.getByText('A2')).toBeInTheDocument();
        expect(renders.get('object:a')).toBe((before.get('object:a') ?? 0) + 1);
        expect(renders.get('children:root')).toBe((before.get('children:root') ?? 0) + 1);
        expect(renders.get('object:b')).toBe(before.get('object:b'));
        expect(renders.get('children:other')).toBe(before.get('children:other'));
        expect(renders.get('query')).toBe(before.get('query'));
    });

    /**
     * Проверяет, что запрос перерисовывается, когда меняется его результат, а подписчик удалённого
     * объекта видит его исчезновение
     */
    it('remove_updatesQueryAndObjectSubscriber', async () => {
        renders.clear();
        const data = await setup(
            <>
                <Name id="c" />
                <Children parent="other" />
                <NoteCount />
            </>,
        );

        await act(() => data.remove('c'));

        expect(screen.getByText('Всего: 2')).toBeInTheDocument();
        expect(screen.getByText('—')).toBeInTheDocument();
    });
});
