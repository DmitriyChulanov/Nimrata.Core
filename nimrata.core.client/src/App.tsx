import { useEffect, useState } from 'react';

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

import './App.css';

import type { DataController } from '@platform';

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

/** Загрузка данных, стартовая структура и достройка повторов; ошибка любого шага не теряется */
async function prepareData(controller: DataController): Promise<string | null> {
    await controller.load();
    if (controller.getSnapshot().status !== 'ready') return null; // ошибку загрузки показывает Main
    const start = await ensureStartStructure(controller);
    if (!start.ok) return start.error;
    const repeats = await ensureRepeats(controller);
    return repeats.ok ? null : repeats.error;
}

function Application({ userId }: { userId: string }) {
    const api = useApi();
    const [controller] = useState(() => createDataController({ api }));
    const [prepareError, setPrepareError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const unregister = registerTracker(controller, { reveal: revealBridge.reveal });
        prepareData(controller).then(
            (error) => {
                if (!cancelled) setPrepareError(error);
            },
            (error: unknown) => {
                if (!cancelled)
                    setPrepareError(error instanceof Error ? error.message : String(error));
            },
        );
        return () => {
            cancelled = true;
            unregister();
        };
    }, [controller]);

    return (
        <DataProvider controller={controller}>
            <SelectionProvider>
                <RevealBinding bridge={revealBridge} />
                <UndoControls registry={menuRegistry} />
                <NotificationsBinding userId={userId} />
                {prepareError && <p role="alert">{prepareError}</p>}
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
                    <Application userId={user.id} />
                </main>
            </div>
        </TabsProvider>
    );
}

/** Токен из ссылки письма (`/reset-password?token=…`); null, если открыт обычный адрес */
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

export function App() {
    return (
        <AuthProvider>
            <TypesProvider>
                <Shell />
            </TypesProvider>
        </AuthProvider>
    );
}
