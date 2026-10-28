import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { DataProvider } from '@platform/data/DataProvider';
import { createFakeApi } from '@platform/data/fakeApi';

import { useActionLauncher } from './useActionLauncher';

import type { ReactNode } from 'react';

const pick = {
    id: 'pick',
    name: 'Выбрать',
    parameters: [{ id: 'level', name: 'Уровень', kind: 'enum' as const }],
};
const types = [
    { id: 'Item', name: 'Элемент', extension: 't', extensionVersion: 1, actions: [pick] },
];
const objects = [
    { id: 'a', type: 'Item', parent: null, order: 0, properties: {} },
    { id: 'b', type: 'Item', parent: null, order: 1, properties: {} },
];

/**
 * Запуск действий над группой через хук
 */
describe('useActionLauncher', () => {
    /**
     * Проверяет, что при отсутствии общих значений параметров запуск не начинается и причина в `error`
     */
    it('launchMany_noCommonParameterValues_setsErrorAndDoesNotRun', async () => {
        const api = createFakeApi(types, objects);
        const data = createDataController({ api });
        await data.load();
        let ran = 0;
        data.registerAction('Item', 'pick', () => void (ran += 1), {
            parameterValues: {
                level: (o) =>
                    o.id === 'a' ? [{ value: 'x', name: 'X' }] : [{ value: 'y', name: 'Y' }],
            },
        });
        const wrapper = ({ children }: { children: ReactNode }) => (
            <DataProvider controller={data}>{children}</DataProvider>
        );
        const { result } = renderHook(() => useActionLauncher(), { wrapper });

        await act(() => result.current.launchMany(['a', 'b'], pick));

        expect(result.current.error).toBe(
            '«Выбрать»: у выделенных объектов нет общих значений параметров.',
        );
        expect(result.current.dialog).toBeNull();
        expect(ran).toBe(0);
    });
});
