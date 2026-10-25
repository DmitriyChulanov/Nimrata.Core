import './App.css';
import {
    AuthProvider,
    DataProvider,
    LoginScreen,
    SelectionProvider,
    Tree,
    TypesProvider,
    Workspace,
    createDataController,
    useAuth,
    useApi,
    useData,
    useSelection,
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
            center={<p>Вкладки появятся здесь.</p>}
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

function Shell() {
    const { status, login, logout } = useAuth();

    if (status === 'loading') return null;
    if (status === 'anonymous') return <LoginScreen onLogin={login} />;

    return (
        <div className="app">
            <header className="app-header">
                <h1>Nimrata</h1>
                <button type="button" onClick={() => void logout()}>
                    Выйти
                </button>
            </header>
            <main className="app-main">
                <Application />
            </main>
        </div>
    );
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
