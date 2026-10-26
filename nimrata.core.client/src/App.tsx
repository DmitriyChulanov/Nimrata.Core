import { useState } from 'react';

import {
    AuthProvider,
    Button,
    DataProvider,
    ExtensionsProvider,
    LoginScreen,
    MainMenu,
    NoExtensionsNotice,
    PropertyGrid,
    RevealBinding,
    ResetPasswordScreen,
    SelectionProvider,
    TabContainer,
    TabsProvider,
    Tree,
    TypesProvider,
    UndoControls,
    Workspace,
    createDataController,
    createRevealBridge,
    extensionRegistry,
    menuRegistry,
    registerAutomation,
    registerExtensionsEditor,
    registerJournal,
    registerTheme,
    registerUsersAdmin,
    tabRegistry,
    useAuth,
    useApi,
    useCurrentUser,
    useData,
    useTabs,
} from '@platform';

import '@/extensions';

import './App.css';

registerAutomation(tabRegistry, menuRegistry);
registerJournal(tabRegistry, menuRegistry);
registerExtensionsEditor(tabRegistry, menuRegistry);
registerUsersAdmin(tabRegistry, menuRegistry);
registerTheme(menuRegistry);

/**
 * Основной экран после входа: состояние загрузки данных или рабочая область из трёх панелей
 *
 * @returns индикатор загрузки, сообщение об ошибке с повтором или рабочая область
 */
function Main() {
    const data = useData();
    const { widths, setWidths } = useTabs();
    const { status, error } = data.getSnapshot();
    const [everReady, setEverReady] = useState(false);

    if (status === 'error') {
        return (
            <div>
                <p role="alert">{error}</p>
                <Button onClick={() => void data.load()}>Повторить</Button>
            </div>
        );
    }
    // Повторная загрузка (смена подключения расширения) не заменяет рабочую область индикатором:
    // иначе вкладки пересоздаются, а состояние Редактора расширений (ошибка карточки) теряется
    if (status === 'ready' && !everReady) setEverReady(true);
    if (status !== 'ready' && !everReady) return <p>Загрузка…</p>;

    return (
        <Workspace
            left={
                <NoExtensionsNotice>
                    <Tree />
                </NoExtensionsNotice>
            }
            center={<TabContainer />}
            initialWidths={widths}
            onWidthsChange={setWidths}
            right={<PropertyGrid />}
        />
    );
}

/**
 * Мост между логикой расширений и выделением узла в дереве
 */
const revealBridge = createRevealBridge();

/**
 * Свойства компонента `Application`
 */
interface ApplicationProps {
    /** Идентификатор вошедшего пользователя */
    userId: string;
}

/**
 * Контекст данных пользователя: контроллер, подключённые расширения (их жизненным циклом и
 * загрузкой данных управляет `ExtensionsProvider`) и основной экран
 *
 * @param props - свойства компонента, описаны в `ApplicationProps`
 * @returns основной экран внутри провайдеров данных, выделения и расширений
 */
function Application({ userId }: ApplicationProps) {
    const api = useApi();
    const [controller] = useState(() => createDataController({ api }));

    return (
        <DataProvider controller={controller}>
            <SelectionProvider>
                <RevealBinding bridge={revealBridge} />
                <UndoControls registry={menuRegistry} />
                <ExtensionsProvider
                    api={api}
                    controller={controller}
                    registry={extensionRegistry}
                    userId={userId}
                    reveal={revealBridge.reveal}
                >
                    <Main />
                </ExtensionsProvider>
            </SelectionProvider>
        </DataProvider>
    );
}

/**
 * Оболочка вошедшего пользователя: шапка с меню и выходом и область приложения
 *
 * @returns интерфейс сессии; ничего, пока неизвестен текущий пользователь
 */
function Session() {
    const { logout } = useAuth();
    const user = useCurrentUser();

    if (!user) return null;

    return (
        <TabsProvider registry={tabRegistry} userId={user.id}>
            <div className="app">
                <header className="app-header">
                    <h1>Nimrata</h1>
                    <MainMenu registry={menuRegistry} role={user.role} />
                    <Button variant="ghost" icon="log-out" onClick={() => void logout()}>
                        Выйти
                    </Button>
                </header>
                <main className="app-main">
                    <Application userId={user.id} />
                </main>
            </div>
        </TabsProvider>
    );
}

/**
 * Токен из ссылки письма (`/reset-password?token=…`); null, если открыт обычный адрес
 */
function readResetToken(): string | null {
    if (window.location.pathname !== '/reset-password') return null;
    return new URLSearchParams(window.location.search).get('token') ?? '';
}

/**
 * Выбирает экран по состоянию входа: смена пароля, вход или сессия
 *
 * @returns экран, подходящий текущему состоянию
 */
function Shell() {
    const { status, login } = useAuth();
    const [resetToken, setResetToken] = useState(readResetToken);

    if (resetToken !== null) {
        return (
            <ResetPasswordScreen
                token={resetToken}
                onDone={() => {
                    window.history.replaceState({}, '', '/');
                    setResetToken(null);
                }}
            />
        );
    }
    if (status === 'loading') return null;
    if (status === 'anonymous') return <LoginScreen onLogin={login} />;

    return <Session />;
}

/**
 * Корень приложения: авторизация, типы и оболочка
 *
 * @returns приложение
 */
export function App() {
    return (
        <AuthProvider>
            <TypesProvider>
                <Shell />
            </TypesProvider>
        </AuthProvider>
    );
}
