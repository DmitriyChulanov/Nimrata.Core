import { useState } from 'react';

import { Icon } from '@platform/icons/Icon';
import { Switch } from '@platform/ui';

import { useExtensions } from './useExtensions';
import './ExtensionsEditor.css';

import type { ExtensionInfo } from './catalog';

/**
 * Свойства карточки расширения
 */
interface ExtensionCardProps {
    /** Расширение каталога */
    extension: ExtensionInfo;
    /** Заблокирована ли карточка (идёт переключение) */
    disabled: boolean;
    /** Ошибка последнего переключения этой карточки */
    error: string | undefined;
    /** Запрашивает новое состояние подключения */
    onToggle(connected: boolean): void;
}

/**
 * Карточка расширения: иконка, название, описание, переключатель и пояснение про данные
 */
function ExtensionCard({ extension, disabled, error, onToggle }: ExtensionCardProps) {
    return (
        <section
            role="group"
            aria-label={extension.name}
            className="extension-card"
            aria-busy={disabled}
        >
            <header className="extension-card-header">
                <Icon name={extension.icon} size="lg" />
                <h2 className="extension-card-title">{extension.name}</h2>
            </header>
            <p className="extension-card-description">{extension.description}</p>
            <Switch
                label="Подключено"
                checked={extension.connected}
                disabled={disabled}
                onChange={(e) => onToggle(e.target.checked)}
            />
            <p className="extension-card-hint">
                Данные скрываются и вернутся при повторном подключении
            </p>
            {error && (
                <p role="alert" className="extension-card-error">
                    {error}
                </p>
            )}
        </section>
    );
}

/**
 * Вкладка «Расширения»: карточки доступных расширений с переключателем подключения. Подтверждения
 * нет: отключение обратимо, данные только скрываются
 *
 * @returns индикатор загрузки или список карточек расширений
 */
export function ExtensionsEditor() {
    const { status, extensions, switchingId, setConnected } = useExtensions();
    const [errors, setErrors] = useState<Record<string, string>>({});

    /**
     * Переключает подключение расширения; ошибку запоминает для его карточки
     *
     * @param id - идентификатор расширения
     * @param connected - нужное состояние подключения
     */
    const toggle = async (id: string, connected: boolean) => {
        setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)));
        const result = await setConnected(id, connected);
        if (!result.ok) setErrors((prev) => ({ ...prev, [id]: result.error }));
    };

    if (status === 'loading') return <p>Загрузка…</p>;

    return (
        <div className="extensions-editor">
            {extensions.map((extension) => (
                <ExtensionCard
                    key={extension.id}
                    extension={extension}
                    // идёт переключение: блокируем все карточки, параллельное запрещено
                    disabled={switchingId !== null}
                    error={errors[extension.id]}
                    onToggle={(connected) => void toggle(extension.id, connected)}
                />
            ))}
        </div>
    );
}
