import './App.css';
import {
    AuthProvider,
    DataProvider,
    LoginScreen,
    MainMenu,
    SelectionProvider,
    TabContainer,
    TabsProvider,
    Tree,
    TypesProvider,
    Workspace,
    createDataController,
    menuRegistry,
    tabRegistry,
    useAuth,
    useApi,
    useCurrentUser,
    useData,
    useSelection,
    useTabs,
} from '@platform';
import { useEffect, useState } from 'react';

/** Временная панель свойств: показывает выделенный объект (таблица свойств — отдельный тикет). */
function SelectedObject() {
    const data = useData();
    const { selectedId } = useSelection();
    const object = selectedId ? data.getObject(selectedId) : undefined;
    if (!object) return <p>Объект не выбран.</p>;
    const name = object.properties.name;
    return (
        <h2>
            {typeof name === 'string' && name
                ? name
                : (data.getType(object.type)?.name ?? object.type)}
        </h2>
    );
}

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
            right={<SelectedObject />}
        />
    );
}

function Application() {
    const api = useApi();
    const [controller] = useState(() => createDataController({ api }));

    useEffect(() => {
        void controller.load();
    }, [controller]);

    return (
        <DataProvider controller={controller}>
            <SelectionProvider>
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

function Shell() {
    const { status, login } = useAuth();

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
