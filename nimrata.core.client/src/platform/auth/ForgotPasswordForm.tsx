import { useState } from 'react';

import { createApiClient } from '@platform/api/apiClient';
import { Button, TextField } from '@platform/ui';

import './AuthCard.css';

import type { FormEvent } from 'react';

/**
 * Свойства компонента `ForgotPasswordForm`
 */
interface ForgotPasswordFormProps {
    /** Возврат к форме входа */
    onBack: () => void;
}

/**
 * Запрос ссылки на смену пароля; ответ одинаков для любого адреса
 */
export function ForgotPasswordForm({ onBack }: ForgotPasswordFormProps) {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function submit(event: FormEvent) {
        event.preventDefault();
        setError(null);
        setBusy(true);
        try {
            await createApiClient().post('auth/forgot-password', { email: email.trim() });
            setSent(true);
        } catch {
            setError('Не удалось отправить запрос, попробуйте позже');
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className="auth-card">
            <h1>Восстановление пароля</h1>
            {sent ? (
                <p role="status">
                    Если такой адрес зарегистрирован, мы отправили на него письмо со ссылкой для
                    смены пароля.
                </p>
            ) : (
                <form onSubmit={(event) => void submit(event)}>
                    <TextField
                        label="Электронная почта"
                        type="email"
                        autoComplete="username"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                    {error && <p role="alert">{error}</p>}
                    <Button type="submit" variant="primary" disabled={busy}>
                        Отправить ссылку
                    </Button>
                </form>
            )}
            <div className="auth-card__links">
                <Button variant="ghost" onClick={onBack}>
                    Вернуться ко входу
                </Button>
            </div>
        </main>
    );
}
