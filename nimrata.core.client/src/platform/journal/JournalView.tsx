import { useEffect, useState } from 'react';

import { Button, Checkbox } from '@platform/ui';

import { describeEntry, formatTime, groupByChangeset, journalPath } from './journal';
import './Journal.css';

import type { ApiClient } from '@platform/api/apiClient';
import type { JournalEntry, JournalPage, JournalResolver } from './journal';

/**
 * Свойства компонента `JournalView`
 */
export interface JournalViewProps {
    /** API-клиент для чтения журнала */
    api: ApiClient;
    /** Выделенный в дереве объект */
    selectedId: string | null;
    /** Сведения об окружении для понятных названий */
    resolver: JournalResolver;
    /** Курсор синхронизации: при его сдвиге первая страница перечитывается */
    cursor?: number;
}

/**
 * Загруженные записи журнала для одного запроса
 */
interface Loaded {
    /** Запрос, которому принадлежат записи (`null` — «все мои изменения») */
    key: string;
    /** Загруженные записи */
    entries: JournalEntry[];
    /** Общее число записей по запросу */
    total: number;
    /** Причина ошибки загрузки или `null` */
    error: string | null;
}

/**
 * Просмотр журнала: записи выбранного объекта или все изменения пользователя. Только чтение
 */
export function JournalView({ api, selectedId, resolver, cursor = 0 }: JournalViewProps) {
    const [all, setAll] = useState(false);
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);

    const objectId = all ? null : selectedId;
    const idle = !all && selectedId === null;
    const key = objectId ?? '*';

    useEffect(() => {
        if (idle) return;
        let cancelled = false;
        api.get<JournalPage>(journalPath(objectId, 0)).then(
            (page) => {
                if (!cancelled)
                    setLoaded({ key, entries: page.items, total: page.total, error: null });
            },
            (error: unknown) => {
                if (!cancelled)
                    setLoaded({
                        key,
                        entries: [],
                        total: 0,
                        error:
                            error instanceof Error ? error.message : 'Не удалось загрузить журнал.',
                    });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [api, idle, objectId, key, cursor]);

    const current = loaded && loaded.key === key ? loaded : null;

    async function loadMore() {
        if (!current) return;
        setLoadingMore(true);
        try {
            const page = await api.get<JournalPage>(journalPath(objectId, current.entries.length));
            setLoaded((prev) =>
                prev && prev.key === key
                    ? { ...prev, entries: [...prev.entries, ...page.items], total: page.total }
                    : prev,
            );
        } catch (error) {
            setLoaded((prev) =>
                prev && prev.key === key
                    ? {
                          ...prev,
                          error:
                              error instanceof Error
                                  ? error.message
                                  : 'Не удалось загрузить журнал.',
                      }
                    : prev,
            );
        } finally {
            setLoadingMore(false);
        }
    }

    let body;
    if (idle) {
        body = (
            <p className="journal-hint">
                Выберите объект в дереве или включите «Все мои изменения».
            </p>
        );
    } else if (!current) {
        body = <p className="journal-hint">Загрузка…</p>;
    } else {
        body = (
            <>
                {current.error && <p role="alert">{current.error}</p>}
                {!current.error && current.entries.length === 0 && (
                    <p className="journal-hint">Записей нет.</p>
                )}
                {current.entries.length > 0 && (
                    <table className="journal-table">
                        <thead>
                            <tr>
                                <th>Когда</th>
                                <th>Кто</th>
                                {all && <th>Объект</th>}
                                <th>Свойство / операция</th>
                                <th>Было</th>
                                <th>Стало</th>
                            </tr>
                        </thead>
                        {groupByChangeset(current.entries).map((group) => (
                            <tbody key={group.changesetId} className="journal-group">
                                {group.entries.map((entry, index) => {
                                    const d = describeEntry(entry, resolver);
                                    return (
                                        <tr key={entry.id}>
                                            {index === 0 && (
                                                <>
                                                    <td rowSpan={group.entries.length}>
                                                        {formatTime(entry.at)}
                                                    </td>
                                                    <td rowSpan={group.entries.length}>
                                                        {entry.user}
                                                    </td>
                                                </>
                                            )}
                                            {all && (
                                                <td>
                                                    {resolver.objectLabel(entry.objectId) ??
                                                        'удалённый объект'}
                                                </td>
                                            )}
                                            <td>{d.what}</td>
                                            <td>{d.was}</td>
                                            <td>{d.became}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        ))}
                    </table>
                )}
                {current.entries.length < current.total && (
                    <Button disabled={loadingMore} onClick={() => void loadMore()}>
                        Показать ещё
                    </Button>
                )}
            </>
        );
    }

    return (
        <section className="journal" aria-label="Журнал">
            <Checkbox
                label="Все мои изменения"
                checked={all}
                onChange={(event) => setAll(event.target.checked)}
            />
            {body}
        </section>
    );
}
