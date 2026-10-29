import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform/data/DataController';
import { createFakeApi, whenSynced } from '@platform/data/fakeApi';

import { SyncIndicator } from './SyncIndicator';
import { SyncStatusProvider } from './SyncStatusProvider';

import type { DataController } from '@platform/data/DataController';
import type { TypeDefinition } from '@platform/types/types';

const types: TypeDefinition[] = [
    {
        id: 'Note',
        name: 'Заметка',
        extension: 't',
        extensionVersion: 1,
        properties: [{ id: 'title', name: 'Название', kind: 'string' }],
    },
];

/**
 * Загруженный контроллер над подставным сервером; `network.down` — fetch отказывает (нет сети)
 *
 * @returns сервер, контроллер и переключатель сети
 */
async function setup() {
    const api = createFakeApi(types, [
        { id: 'a', type: 'Note', parent: null, number: 1, properties: { title: 'A' } },
    ]);
    const network = { down: false };
    const post = api.post.bind(api);
    api.post = (path, body) =>
        network.down ? Promise.reject(new TypeError('Failed to fetch')) : post(path, body);
    const controller = createDataController({ api });
    await controller.load();
    return { api, controller, network };
}

/**
 * Рисует индикатор в провайдере состояния синхронизации
 *
 * @param controller - контроллер данных
 * @param unsentCount - число неотправленных всех вкладок; по умолчанию — своя очередь
 * @param signedInOffline - вход не проверен из-за сети
 */
function renderIndicator(
    controller: DataController,
    unsentCount: () => Promise<number> = () => Promise.resolve(controller.sync.pending().length),
    signedInOffline = false,
) {
    return render(
        <SyncStatusProvider
            controller={controller}
            unsentCount={unsentCount}
            signedInOffline={signedInOffline}
        >
            <SyncIndicator />
        </SyncStatusProvider>,
    );
}

/**
 * Индикатор синхронизации в шапке
 */
describe('SyncIndicator', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Проверяет, что после загрузки без правок показано «Синхронизировано» с подсказкой
     */
    it('indicator_nothingUnsent_showsSyncedWithDetail', async () => {
        const { controller } = await setup();

        renderIndicator(controller);

        const button = await screen.findByRole('button', { name: /Синхронизировано/ });
        expect(button).toHaveAccessibleDescription(/Все изменения сохранены на сервере/);
        controller.dispose();
    });

    /**
     * Проверяет, что число неотправленных берётся из всех вкладок и обновляется при правке
     */
    it('indicator_unsentInAllTabs_showsCount', async () => {
        const { controller } = await setup();
        let others = 2;

        renderIndicator(controller, () =>
            Promise.resolve(others + controller.sync.pending().length),
        );
        expect(await screen.findByRole('button', { name: /2 неотправленных/ })).toBeVisible();

        others = 0;
        await act(() => controller.setProperty('a', 'title', 'B'));
        expect(await screen.findByRole('button', { name: /1 неотправленное/ })).toBeVisible();
        await act(() => whenSynced(controller));
        expect(await screen.findByRole('button', { name: /Синхронизировано/ })).toBeVisible();
        controller.dispose();
    });

    /**
     * Проверяет, что без сети показано «Офлайн», а нажатие после возврата сети отправляет
     * очередь сразу, не дожидаясь задержки повтора
     */
    it('indicator_networkDown_offlineThenClickSendsNow', async () => {
        const { api, controller, network } = await setup();
        network.down = true;
        renderIndicator(controller);

        await act(() => controller.setProperty('a', 'title', 'B'));
        const offline = await screen.findByRole('button', { name: /Офлайн/ }, { timeout: 2000 });
        expect(offline).toHaveAccessibleDescription(/Неотправленных изменений: 1/);

        network.down = false;
        await userEvent.click(offline);

        expect(await screen.findByRole('button', { name: /Синхронизировано/ })).toBeVisible();
        expect(api.changesets).toHaveLength(1);
        controller.dispose();
    });

    /**
     * Проверяет, что сбой сервера показан как «Ошибка» с причиной в подсказке
     */
    it('indicator_serverFailure_showsErrorWithReason', async () => {
        const { api, controller } = await setup();
        api.rejectNext(500, 'Сервер недоступен.');
        renderIndicator(controller);

        await act(() => controller.setProperty('a', 'title', 'B'));

        const error = await screen.findByRole('button', { name: /Ошибка/ }, { timeout: 2000 });
        expect(error).toHaveAccessibleDescription(/Сервер недоступен/);
        controller.dispose();
    });

    /**
     * Проверяет, что вход без проверки из-за сети — «Офлайн»
     */
    it('indicator_signedInOffline_showsOffline', async () => {
        const { controller } = await setup();

        renderIndicator(controller, undefined, true);

        expect(await screen.findByRole('button', { name: /Офлайн/ })).toBeVisible();
        controller.dispose();
    });

    /**
     * Проверяет, что даже с неотправленными изменениями страница не просит подтверждения ухода
     */
    it('indicator_unsent_noBeforeUnloadWarning', async () => {
        const { controller, network } = await setup();
        network.down = true;
        const listen = vi.spyOn(window, 'addEventListener');

        renderIndicator(controller);
        await act(() => controller.setProperty('a', 'title', 'B'));
        await screen.findByRole('button', { name: /1 неотправленное|Офлайн/ });

        expect(listen.mock.calls.map(([type]) => type)).not.toContain('beforeunload');
        controller.dispose();
    });
});
