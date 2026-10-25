import { useState } from 'react';

import { createApiClient } from '@platform/api/apiClient';

import type { FormEvent } from 'react';

interface ForgotPasswordFormProps {
    onBack: () => void;
}

/** Запрос ссылки на смену пароля; ответ одинаков для любого адреса */
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
        <main>
            <h1>Восстановление пароля</h1>
            {sent ? (
                <p role="status">
                    Если такой адрес зарегистрирован, мы отправили на него письмо со ссылкой для
                    смены пароля.
                </p>
            ) : (
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
                    {error && <p role="alert">{error}</p>}
                    <button type="submit" disabled={busy}>
                        Отправить ссылку
                    </button>
                </form>
            )}
            <p>
                <button type="button" onClick={onBack}>
                    Вернуться ко входу
                </button>
            </p>
        </main>
    );
}
