import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MainMenu } from '../tabs/MainMenu';
import { TabContainer } from '../tabs/TabContainer';
import { TabsProvider } from '../tabs/TabsProvider';
import { createMenuRegistry, createTabRegistry } from '../tabs/registries';
import { ExtensionsContext } from './ExtensionsContext';
import { ExtensionsEditor } from './ExtensionsEditor';
import { NoExtensionsNotice } from './NoExtensionsNotice';
import { registerExtensionsEditor } from './registerExtensionsEditor';

import type { ChangeResult } from '../data/DataController';
import type { ExtensionInfo } from './catalog';
import type { ExtensionsValue } from './ExtensionsContext';

const item = (id: string, name: string, connected: boolean, icon = 'check'): ExtensionInfo => ({
    id,
    name,
    description: `Описание ${name}`,
    icon,
    defaultEnabled: true,
    connected,
    commands: [],
});

function value(extensions: ExtensionInfo[], extra: Partial<ExtensionsValue> = {}): ExtensionsValue {
    return {
        status: 'ready',
        error: null,
        extensions,
        switchingId: null,
        setConnected: vi.fn(async (): Promise<ChangeResult> => ({ ok: true })),
        reload: vi.fn(async () => {}),
        ...extra,
    };
}

function renderEditor(v: ExtensionsValue) {
    return render(
        <ExtensionsContext.Provider value={v}>
            <ExtensionsEditor />
        </ExtensionsContext.Provider>,
    );
}

/**
 * Карточки расширений в Редакторе
 */
describe('ExtensionsEditor', () => {
    /**
     * Проверяет, что карточка показывает название, описание, переключатель и подсказку о данных
     */
    it('editor_extensions_showsCardWithNameDescriptionSwitchAndHint', () => {
        renderEditor(value([item('tasks', 'Трекер задач', true)]));

        const card = screen.getByRole('group', { name: 'Трекер задач' });
        expect(within(card).getByText('Описание Трекер задач')).toBeInTheDocument();
        expect(within(card).getByRole('switch', { name: 'Подключено' })).toBeChecked();
        expect(
            within(card).getByText('Данные скрываются и вернутся при повторном подключении'),
        ).toBeInTheDocument();
    });

    /**
     * Проверяет, что неизвестное имя иконки не роняет карточку
     */
    it('editor_unknownIcon_rendersCardWithFallbackIcon', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        renderEditor(value([item('x', 'Икс', false, 'no-such-icon')]));

        expect(screen.getByRole('group', { name: 'Икс' })).toBeInTheDocument();
    });

    /**
     * Проверяет, что переключение вызывает setConnected без диалога подтверждения
     */
    it('editor_toggleSwitch_callsSetConnectedWithoutConfirmation', async () => {
        const v = value([item('tasks', 'Трекер задач', true)]);
        renderEditor(v);

        await userEvent.click(screen.getByRole('switch', { name: 'Подключено' }));

        expect(v.setConnected).toHaveBeenCalledWith('tasks', false);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    /**
     * Проверяет, что во время переключения карточка заблокирована
     */
    it('editor_switching_disablesCardSwitch', () => {
        renderEditor(
            value([item('tasks', 'Трекер задач', true), item('notes', 'Трекер заметок', true)], {
                switchingId: 'tasks',
            }),
        );

        const [tasks, notes] = screen.getAllByRole('switch');
        expect(tasks).toBeDisabled();
        // параллельное переключение запрещено и для остальных карточек
        expect(notes).toBeDisabled();
    });

    /**
     * Проверяет, что отказ сервера показывается у карточки
     */
    it('editor_setConnectedFails_showsErrorOnCard', async () => {
        const v = value([item('tasks', 'Трекер задач', false)], {
            setConnected: vi.fn(async () => ({ ok: false, error: 'Сервер недоступен' })),
        });
        renderEditor(v);

        await userEvent.click(screen.getByRole('switch', { name: 'Подключено' }));

        const card = screen.getByRole('group', { name: 'Трекер задач' });
        expect(await within(card).findByRole('alert')).toHaveTextContent('Сервер недоступен');
    });

    /**
     * Проверяет, что переключатель доступен с клавиатуры
     */
    it('editor_keyboard_tabFocusesSwitchAndSpaceToggles', async () => {
        const v = value([item('tasks', 'Трекер задач', true)]);
        renderEditor(v);

        await userEvent.tab();
        expect(screen.getByRole('switch')).toHaveFocus();
        await userEvent.keyboard(' ');

        expect(v.setConnected).toHaveBeenCalledWith('tasks', false);
    });

    /**
     * Проверяет сообщение, пока каталог загружается
     */
    it('editor_loading_showsLoadingText', () => {
        renderEditor(value([], { status: 'loading' }));

        expect(screen.getByText('Загрузка…')).toBeInTheDocument();
    });
});

/**
 * Регистрация вкладки и пункта меню
 */
describe('registerExtensionsEditor', () => {
    /**
     * Проверяет, что «Вид → Расширения» открывает одну вкладку, повторный выбор не дублирует
     */
    it('registerExtensionsEditor_menuViewExtensions_opensSingleTab', async () => {
        const tabs = createTabRegistry();
        const menu = createMenuRegistry();
        registerExtensionsEditor(tabs, menu);

        render(
            <ExtensionsContext.Provider value={value([item('tasks', 'Трекер задач', true)])}>
                <TabsProvider registry={tabs} userId="u1">
                    <MainMenu registry={menu} role="member" />
                    <TabContainer />
                </TabsProvider>
            </ExtensionsContext.Provider>,
        );

        for (let i = 0; i < 2; i++) {
            await userEvent.click(screen.getByRole('menuitem', { name: 'Вид' }));
            await userEvent.click(screen.getByRole('menuitem', { name: 'Расширения' }));
        }

        await waitFor(() =>
            expect(screen.getAllByRole('tab', { name: 'Расширения' })).toHaveLength(1),
        );
        expect(screen.getByRole('group', { name: 'Трекер задач' })).toBeInTheDocument();
    });
});

/**
 * Пустое состояние, когда отключены все расширения
 */
describe('NoExtensionsNotice', () => {
    /**
     * Проверяет, что при всех отключённых расширениях показана подсказка открыть «Вид → Расширения»
     */
    it('notice_allDisconnected_showsHintToOpenViewExtensions', () => {
        render(
            <ExtensionsContext.Provider
                value={value([item('a', 'А', false), item('b', 'Б', false)])}
            >
                <NoExtensionsNotice>дерево</NoExtensionsNotice>
            </ExtensionsContext.Provider>,
        );

        expect(screen.getByText(/Вид → Расширения/)).toBeInTheDocument();
        expect(screen.queryByText('дерево')).not.toBeInTheDocument();
    });

    /**
     * Проверяет, что при наличии подключённого расширения показаны вложенные элементы
     */
    it('notice_someConnected_rendersChildren', () => {
        render(
            <ExtensionsContext.Provider
                value={value([item('a', 'А', true), item('b', 'Б', false)])}
            >
                <NoExtensionsNotice>дерево</NoExtensionsNotice>
            </ExtensionsContext.Provider>,
        );

        expect(screen.getByText('дерево')).toBeInTheDocument();
    });
});
