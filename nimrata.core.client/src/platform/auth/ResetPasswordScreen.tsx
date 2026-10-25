import { useState } from 'react';

import { createApiClient } from '@platform/api/apiClient';

import type { FormEvent } from 'react';

interface ResetPasswordScreenProps {
    /** Одноразовый токен из ссылки письма */
    token: string;
    /** Переход ко входу после успешной смены пароля */
    onDone: () => void;
}

const MIN_PASSWORD_LENGTH = 8;

/** Установка нового пароля по ссылке из письма */
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
            <main>
                <h1>Новый пароль</h1>
                <p role="status">Пароль изменён. Теперь можно войти с новым паролем.</p>
                <button type="button" onClick={onDone}>
                    Перейти ко входу
                </button>
            </main>
        );
    }

    return (
        <main>
            <h1>Новый пароль</h1>
            <form onSubmit={(event) => void submit(event)}>
                <p>
                    <label>
                        Новый пароль
                        <input
                            type="password"
                            autoComplete="new-password"
                            required
                            minLength={MIN_PASSWORD_LENGTH}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </label>
                </p>
                <p>
                    <label>
                        Повторите пароль
                        <input
                            type="password"
                            autoComplete="new-password"
                            required
                            value={repeat}
                            onChange={(e) => setRepeat(e.target.value)}
                        />
                    </label>
                </p>
                {error && <p role="alert">{error}</p>}
                <button type="submit" disabled={busy}>
                    Сменить пароль
                </button>
            </form>
        </main>
    );
}
