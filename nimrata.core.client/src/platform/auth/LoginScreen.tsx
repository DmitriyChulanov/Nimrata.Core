import { useState } from 'react';

import { ApiError } from '@platform/api/apiClient';
import { Button, TextField } from '@platform/ui';

import './AuthCard.css';
import { ForgotPasswordForm } from './ForgotPasswordForm';

import type { FormEvent } from 'react';

/**
 * Свойства компонента `LoginScreen`
 */
interface LoginScreenProps {
    /** Вход по адресу и паролю; при отказе бросает ошибку с причиной */
    onLogin: (email: string, password: string) => Promise<void>;
}

/**
 * Экран входа с переходом к запросу ссылки на смену пароля
 *
 * @param props - обработчик входа
 * @returns форма входа
 */
export function LoginScreen({ onLogin }: LoginScreenProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [forgot, setForgot] = useState(false);

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

    if (forgot) return <ForgotPasswordForm onBack={() => setForgot(false)} />;

    return (
        <main className="auth-card">
            <h1>Вход в Nimrata</h1>
            <form onSubmit={(event) => void submit(event)}>
                <TextField
                    label="Электронная почта"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
                <TextField
                    label="Пароль"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
                {error && <p role="alert">{error}</p>}
                <Button type="submit" variant="primary" disabled={busy}>
                    Войти
                </Button>
            </form>
            <div className="auth-card__links">
                <Button variant="ghost" onClick={() => setForgot(true)}>
                    Забыли пароль?
                </Button>
            </div>
        </main>
    );
}
