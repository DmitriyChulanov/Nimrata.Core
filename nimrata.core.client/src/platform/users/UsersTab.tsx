import { useCallback, useEffect, useState } from 'react';

import { useApi } from '@platform/auth/useApi';
import { Button, Select, TextField } from '@platform/ui';

import './UsersTab.css';

import type { FormEvent } from 'react';
import type { UserRole } from '@platform/tabs/registries';

/**
 * Пользователь в списке администратора
 */
interface ManagedUser {
    /** Идентификатор пользователя */
    id: string;
    /** Адрес электронной почты */
    email: string;
    /** Отображаемое имя */
    name: string;
    /** Роль пользователя */
    role: UserRole;
    /** Не отключён ли пользователь */
    isActive: boolean;
}

/**
 * Названия ролей для показа
 */
const ROLE_TITLES: Record<UserRole, string> = { admin: 'Администратор', member: 'Участник' };

/**
 * Путь административного API пользователей
 */
const BASE = '/admin/users';

/**
 * Варианты роли для выпадающих списков
 */
const ROLE_OPTIONS = [
    { value: 'member', label: ROLE_TITLES.member },
    { value: 'admin', label: ROLE_TITLES.admin },
];

/**
 * Вкладка «Пользователи» (только администратор): список, создание, смена роли, отключение и включение
 */
export function UsersTab() {
    const api = useApi();
    const [users, setUsers] = useState<ManagedUser[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<UserRole>('member');

    const load = useCallback(async () => {
        setUsers(await api.get<ManagedUser[]>(BASE));
    }, [api]);

    /**
     * Выполняет операцию, затем перечитывает список; при отказе показывает причину сервера
     */
    const run = useCallback(
        async (operation: () => Promise<unknown>): Promise<boolean> => {
            setError(null);
            setNotice(null);
            try {
                await operation();
                await load();
                return true;
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Не удалось выполнить операцию.');
                // после отказа список перечитывается, чтобы форма не расходилась с сервером
                await load().catch(() => undefined);
                return false;
            }
        },
        [load],
    );

    useEffect(() => {
        let cancelled = false;
        api.get<ManagedUser[]>(BASE)
            .then((list) => {
                if (!cancelled) setUsers(list);
            })
            .catch((e: unknown) => {
                if (!cancelled)
                    setError(e instanceof Error ? e.message : 'Не удалось загрузить список.');
            });
        return () => {
            cancelled = true;
        };
    }, [api]);

    const create = async (event: FormEvent) => {
        event.preventDefault();
        const ok = await run(() => api.post(BASE, { email, name, password, role }));
        if (ok) {
            setEmail('');
            setName('');
            setPassword('');
            setRole('member');
        }
    };

    return (
        <section className="users-tab" aria-label="Пользователи">
            {error && <p role="alert">{error}</p>}
            {notice && <p role="status">{notice}</p>}
            <form className="users-tab__form" onSubmit={(e) => void create(e)}>
                <TextField
                    label="Электронная почта"
                    type="email"
                    value={email}
                    required
                    onChange={(e) => setEmail(e.target.value)}
                />
                <TextField label="Имя" value={name} onChange={(e) => setName(e.target.value)} />
                <TextField
                    label="Пароль"
                    type="password"
                    value={password}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                />
                <Select
                    label="Роль"
                    value={role}
                    options={ROLE_OPTIONS}
                    onChange={(e) => {
                        const next = e.target.value;
                        if (next === 'admin' || next === 'member') setRole(next);
                    }}
                />
                <Button type="submit" variant="primary">
                    Создать
                </Button>
            </form>
            <table className="users-tab__table">
                <thead>
                    <tr>
                        <th>Электронная почта</th>
                        <th>Имя</th>
                        <th>Роль</th>
                        <th>Состояние</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {users.map((u) => (
                        <tr key={u.id}>
                            <td>{u.email}</td>
                            <td>{u.name}</td>
                            <td>
                                <select
                                    aria-label={`Роль ${u.email}`}
                                    value={u.role}
                                    onChange={(e) =>
                                        void run(() =>
                                            api.put(`${BASE}/${u.id}/role`, {
                                                role: e.target.value,
                                            }),
                                        )
                                    }
                                >
                                    {ROLE_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                            </td>
                            <td>{u.isActive ? 'Активен' : 'Отключён'}</td>
                            <td>
                                <div className="users-tab__actions">
                                    <Button
                                        variant={u.isActive ? 'danger' : 'secondary'}
                                        aria-label={`${u.isActive ? 'Отключить' : 'Включить'} ${u.email}`}
                                        onClick={() =>
                                            void run(() =>
                                                api.post(
                                                    `${BASE}/${u.id}/${u.isActive ? 'disable' : 'enable'}`,
                                                ),
                                            )
                                        }
                                    >
                                        {u.isActive ? 'Отключить' : 'Включить'}
                                    </Button>
                                    {u.isActive && (
                                        <Button
                                            variant="ghost"
                                            aria-label={`Отправить ссылку на смену пароля ${u.email}`}
                                            onClick={() =>
                                                void run(async () => {
                                                    await api.post(
                                                        `${BASE}/${u.id}/password-reset`,
                                                    );
                                                    setNotice(
                                                        `Ссылка на смену пароля отправлена на ${u.email}.`,
                                                    );
                                                })
                                            }
                                        >
                                            Отправить ссылку на смену пароля
                                        </Button>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}
