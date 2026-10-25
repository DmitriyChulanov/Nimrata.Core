import './App.css';
import { AuthProvider, LoginScreen, useAuth } from '@platform';

function Shell() {
    const { status, login, logout } = useAuth();

    if (status === 'loading') return null;
    if (status === 'anonymous') return <LoginScreen onLogin={login} />;

    return (
        <main>
            <h1>Nimrata</h1>
            <p>Интерфейс появится здесь.</p>
            <button type="button" onClick={() => void logout()}>
                Выйти
            </button>
        </main>
    );
}

function App() {
    return (
        <AuthProvider>
            <Shell />
        </AuthProvider>
    );
}

export default App;
