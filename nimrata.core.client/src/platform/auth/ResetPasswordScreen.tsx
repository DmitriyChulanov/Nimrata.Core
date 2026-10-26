import { useState } from 'react';

import { createApiClient } from '@platform/api/apiClient';
import { Button, TextField } from '@platform/ui';

import './AuthCard.css';

import type { FormEvent } from 'react';

/**
 * Свойства компонента `ResetPasswordScreen`
 */
interface ResetPasswordScreenProps {
    /** Одноразовый токен из ссылки письма */
    token: string;
    /** Переход ко входу после успешной смены пароля */
    onDone: () => void;
}

/**
 * Минимальная длина нового пароля (совпадает с проверкой на сервере)
 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Установка нового пароля по ссылке из письма
 */
export function ResetPasswordScreen({ token, onDone }: ResetPasswordScreenProps) {
    const [password, setPassword] = useState('');
    const [repeat, setRepeat] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [busy, setBusy] = useState(false);

    async function submit(event: FormEvent) {
        event.preventDefault();
        setError(null);
        if (password !== repeat) {
            setError('Пароли не совпадают');
            return;
        }
        setBusy(true);
        try {
            await createApiClient().post('auth/reset-password', { token, password });
            setDone(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось сменить пароль');
        } finally {
            setBusy(false);
        }
    }

    if (done) {
        return (
            <main className="auth-card">
                <h1>Новый пароль</h1>
                <p role="status">Пароль изменён. Теперь можно войти с новым паролем.</p>
                <Button variant="primary" onClick={onDone}>
                    Перейти ко входу
                </Button>
            </main>
        );
    }

    return (
        <main className="auth-card">
            <h1>Новый пароль</h1>
            <form onSubmit={(event) => void submit(event)}>
                <TextField
                    label="Новый пароль"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
                <TextField
                    label="Повторите пароль"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                />
                {error && <p role="alert">{error}</p>}
                <Button type="submit" variant="primary" disabled={busy}>
                    Сменить пароль
                </Button>
            </form>
        </main>
    );
}
