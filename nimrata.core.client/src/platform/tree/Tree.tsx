import { useEffect, useMemo, useRef, useState } from 'react';

import type { DataController, DataObject } from '../data/DataController';
import { useData } from '../data/DataProvider';
import { useSelection } from '../selection/SelectionProvider';
import type { TypeDefinition } from '../types/types';

const ROW_HEIGHT = 24;
const OVERSCAN = 5;
/** Высота окна, пока она неизвестна (например, до первого измерения). */
const DEFAULT_VIEWPORT = 400;
const collator = new Intl.Collator('ru');

interface Row {
    object: DataObject;
    title: string;
    level: number;
    hasChildren: boolean;
}

function titleOf(data: DataController, object: DataObject): string {
    const name = object.properties.name;
    if (typeof name === 'string' && name !== '') return name;
    return data.getType(object.type)?.name ?? object.type;
}

/** Типы, объекты которых можно создать под узлом: допустимые дочерние неабстрактные типы. */
function creatableTypes(data: DataController, parent: DataObject): TypeDefinition[] {
    const allowed = data.getType(parent.type)?.allowedChildren ?? [];
    return allowed
        .map((id) => data.getType(id))
        .filter((t): t is TypeDefinition => t !== undefined && !t.abstract);
}

/** Видимые потомки узла: без скрытых типов, по порядку, затем по названию. */
function visibleChildren(data: DataController, parent: string | null) {
    return data
        .getChildren(parent)
        .filter((o) => !data.getType(o.type)?.hiddenInTree)
        .map((object) => ({ object, title: titleOf(data, object) }))
        .sort(
            (a, b) =>
                a.object.order - b.object.order ||
                collator.compare(a.title, b.title) ||
                (a.object.id < b.object.id ? -1 : 1),
        );
}

function flatten(data: DataController, expanded: ReadonlySet<string>): Row[] {
    const rows: Row[] = [];
    const walk = (parent: string | null, level: number) => {
        for (const { object, title } of visibleChildren(data, parent)) {
            const hasChildren = visibleChildren(data, object.id).length > 0;
            rows.push({ object, title, level, hasChildren });
            if (hasChildren && expanded.has(object.id)) walk(object.id, level + 1);
        }
    };
    walk(null, 1);
    return rows;
}

/** Универсальное дерево: строится по типам и объектам `DataController`, не зная о модулях. */
export function Tree() {
    const data = useData();
    const { selectedId, select } = useSelection();
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const version = data.getSnapshot().version;

    // eslint-disable-next-line react-hooks/exhaustive-deps -- модель меняется по `version`
    const rows = useMemo(() => flatten(data, expanded), [data, expanded, version]);

    const toggle = (id: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (!next.delete(id)) next.add(id);
            return next;
        });

    // Виртуализация: рисуются только строки в окне прокрутки плюс небольшой запас.
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const measure = () => setViewport(element.clientHeight || DEFAULT_VIEWPORT);
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);

    const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!menu) return;
        const close = () => setMenu(null);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('click', close);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('click', close);
            document.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    const createChild = async (parent: string, type: string) => {
        setError(null);
        const result = await data.create({ type, parent });
        if (result.ok) setExpanded((prev) => new Set(prev).add(parent));
        else setError(result.error);
    };

    const confirmDelete = async (id: string) => {
        setDeleting(null);
        setError(null);
        const result = await data.remove(id);
        if (!result.ok) setError(result.error);
        else if (selectedId !== null && !data.getObject(selectedId)) select(null);
    };

    const menuObject = menu ? data.getObject(menu.id) : undefined;
    const creatable = menuObject ? creatableTypes(data, menuObject) : [];
    const deletingObject = deleting ? data.getObject(deleting) : undefined;

    return (
        <>
            {error && <p role="alert">{error}</p>}
            <div
                ref={containerRef}
                role="tree"
                aria-label="Дерево объектов"
                style={{ height: '100%', overflow: 'auto', position: 'relative' }}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
                <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
                    {rows.slice(first, last).map(({ object, title, level, hasChildren }, i) => {
                        const isOpen = expanded.has(object.id);
                        return (
                            <div
                                key={object.id}
                                role="treeitem"
                                aria-label={title}
                                aria-level={level}
                                aria-posinset={first + i + 1}
                                aria-setsize={rows.length}
                                aria-selected={selectedId === object.id}
                                aria-expanded={hasChildren ? isOpen : undefined}
                                style={{
                                    position: 'absolute',
                                    top: (first + i) * ROW_HEIGHT,
                                    height: ROW_HEIGHT,
                                    left: 0,
                                    right: 0,
                                    paddingLeft: `${(level - 1) * 16}px`,
                                }}
                                onClick={() => select(object.id)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    select(object.id);
                                    setMenu({ id: object.id, x: e.clientX, y: e.clientY });
                                }}
                            >
                                {hasChildren ? (
                                    <button
                                        type="button"
                                        aria-label={isOpen ? 'Свернуть' : 'Развернуть'}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggle(object.id);
                                        }}
                                    >
                                        {isOpen ? '▾' : '▸'}
                                    </button>
                                ) : (
                                    <span aria-hidden="true" />
                                )}
                                <span aria-hidden="true">
                                    {data.getType(object.type)?.icon ?? '•'}
                                </span>
                                <span>{title}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
            {menu && menuObject && (
                <ul
                    role="menu"
                    aria-label="Действия с объектом"
                    style={{ position: 'fixed', left: menu.x, top: menu.y, margin: 0, padding: 4 }}
                >
                    {creatable.map((type) => (
                        <li key={type.id} role="none">
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => void createChild(menuObject.id, type.id)}
                            >
                                Создать: {type.name}
                            </button>
                        </li>
                    ))}
                    <li role="none">
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => setDeleting(menuObject.id)}
                        >
                            Удалить
                        </button>
                    </li>
                </ul>
            )}
            {deletingObject && (
                <div role="alertdialog" aria-modal="true" aria-label="Подтверждение удаления">
                    <p>
                        Удалить «{titleOf(data, deletingObject)}» вместе со всеми вложенными
                        объектами?
                    </p>
                    <button type="button" onClick={() => void confirmDelete(deletingObject.id)}>
                        Удалить
                    </button>
                    <button type="button" onClick={() => setDeleting(null)}>
                        Отмена
                    </button>
                </div>
            )}
        </>
    );
}
