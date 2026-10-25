import { useState } from 'react';
import type { FormEvent } from 'react';

import { ApiError } from '../api/apiClient';

interface LoginScreenProps {
    onLogin: (email: string, password: string) => Promise<void>;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function submit(event: FormEvent) {
        event.preventDefault();
        setError(null);
        setBusy(true);
        try {
            await onLogin(email, password);
        } catch (e) {
            setError(
                e instanceof ApiError && e.status === 401
                    ? 'Неверный e-mail или пароль'
                    : 'Не удалось выполнить вход, попробуйте позже',
            );
            setBusy(false);
        }
    }

    return (
        <main>
            <h1>Вход в Nimrata</h1>
            <form onSubmit={(event) => void submit(event)}>
                <p>
                    <label>
                        Электронная почта
                        <input
                            type="email"
                            autoComplete="username"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </label>
                </p>
                <p>
                    <label>
                        Пароль
                        <input
                            type="password"
                            autoComplete="current-password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </label>
                </p>
                {error && <p role="alert">{error}</p>}
                <button type="submit" disabled={busy}>
                    Войти
                </button>
            </form>
        </main>
    );
}
