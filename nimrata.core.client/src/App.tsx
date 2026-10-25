import './App.css';
import {
    AuthProvider,
    DataProvider,
    LoginScreen,
    MainMenu,
    PropertyGrid,
    ResetPasswordScreen,
    SelectionProvider,
    TabContainer,
    TabsProvider,
    Tree,
    TypesProvider,
    UndoControls,
    Workspace,
    createDataController,
    menuRegistry,
    registerAutomation,
    registerJournal,
    registerUsersAdmin,
    tabRegistry,
    useAuth,
    useApi,
    useCurrentUser,
    useData,
    useTabs,
} from '@platform';
import {
    NotificationsBinding,
    RevealBinding,
    createRevealBridge,
    ensureRepeats,
    ensureStartStructure,
    registerTracker,
} from '@tracker/index';
import { useEffect, useState } from 'react';

registerAutomation(tabRegistry, menuRegistry);
registerJournal(tabRegistry, menuRegistry);
registerUsersAdmin(tabRegistry, menuRegistry);

function Main() {
    const data = useData();
    const { widths, setWidths } = useTabs();
    const { status, error } = data.getSnapshot();

    if (status === 'error') {
        return (
            <div>
                <p role="alert">{error}</p>
                <button type="button" onClick={() => void data.load()}>
                    Повторить
                </button>
            </div>
        );
    }
    if (status !== 'ready') return <p>Загрузка…</p>;

    return (
        <Workspace
            left={<Tree />}
            center={<TabContainer />}
            initialWidths={widths}
            onWidthsChange={setWidths}
            right={<PropertyGrid />}
        />
    );
}

const revealBridge = createRevealBridge();

function Application() {
    const api = useApi();
    const [controller] = useState(() => createDataController({ api }));

    useEffect(() => {
        const unregister = registerTracker(controller, { reveal: revealBridge.reveal });
        void controller
            .load()
            .then(() => ensureStartStructure(controller))
            .then(() => ensureRepeats(controller));
        return unregister;
    }, [controller]);

    return (
        <DataProvider controller={controller}>
            <SelectionProvider>
                <RevealBinding bridge={revealBridge} />
                <UndoControls registry={menuRegistry} />
                <NotificationsBinding />
                <Main />
            </SelectionProvider>
        </DataProvider>
    );
}

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
                    <button type="button" onClick={() => void logout()}>
                        Выйти
                    </button>
                </header>
                <main className="app-main">
                    <Application />
                </main>
            </div>
        </TabsProvider>
    );
}

/** Токен из ссылки письма (`/reset-password?token=…`); null, если открыт обычный адрес. */
function readResetToken(): string | null {
    if (window.location.pathname !== '/reset-password') return null;
    return new URLSearchParams(window.location.search).get('token') ?? '';
}

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

function App() {
    return (
        <AuthProvider>
            <TypesProvider>
                <Shell />
            </TypesProvider>
        </AuthProvider>
    );
}

export default App;
