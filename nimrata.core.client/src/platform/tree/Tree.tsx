import { useEffect, useMemo, useRef, useState } from 'react';

import { useActionLauncher } from '@platform/actions/useActionLauncher';
import { useData } from '@platform/data/useData';
import { ChevronIcon } from '@platform/icons/Icons';
import { useSelection } from '@platform/selection/useSelection';

import { planMove, positionInRow } from './planMove';
import { colorPresentation, resolveRuleColor } from './colorRules';
import './ruleColors.css';

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DataController, DataObject } from '@platform/data/DataController';
import type { TypeDefinition } from '@platform/types/types';
import type { DropPosition } from './planMove';

/**
 * Высота строки дерева в пикселях
 */
const ROW_HEIGHT = 24;
/**
 * Сколько строк рисуется сверх видимых для плавной прокрутки
 */
const OVERSCAN = 5;
/**
 * Высота окна, пока она неизвестна (например, до первого измерения)
 */
const DEFAULT_VIEWPORT = 400;
/**
 * Сравнение названий по правилам русского языка
 */
const collator = new Intl.Collator('ru');

/**
 * Строка плоского списка дерева
 */
interface Row {
    /** Объект строки */
    object: DataObject;
    /** Название для показа */
    title: string;
    /** Уровень вложенности; корень — 0 */
    level: number;
    /** Есть ли видимые потомки */
    hasChildren: boolean;
}

/**
 * Название объекта для показа: вычисляемое имя, иначе название типа
 *
 * @param data - контроллер данных
 * @param object - объект
 * @returns текст названия
 */
function titleOf(data: DataController, object: DataObject): string {
    const name = object.properties.name;
    if (typeof name === 'string' && name !== '') return name;
    return data.getType(object.type)?.name ?? object.type;
}

/**
 * Типы, объекты которых можно создать под узлом: допустимые дочерние неабстрактные типы
 */
function creatableTypes(data: DataController, parent: DataObject): TypeDefinition[] {
    const allowed = data.getType(parent.type)?.allowedChildren ?? [];
    return allowed
        .map((id) => data.getType(id))
        .filter((t): t is TypeDefinition => t !== undefined && !t.abstract);
}

/**
 * Видимые потомки узла: без скрытых типов, по порядку, затем по названию
 */
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

/**
 * Разворачивает дерево в плоский список видимых строк
 *
 * @param data - контроллер данных
 * @param expanded - идентификаторы раскрытых узлов
 * @returns строки по порядку показа
 */
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

/**
 * Универсальное дерево: строится по типам и объектам `DataController`, не зная о модулях
 */
export function Tree() {
    const data = useData();
    const { selectedId, select, revealRequest } = useSelection();
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

    // Переход к объекту (reveal): раскрыть родителей (подстройка состояния при рендере), затем прокрутить
    const [handledReveal, setHandledReveal] = useState(revealRequest?.seq ?? 0);
    if (revealRequest && revealRequest.seq !== handledReveal) {
        setHandledReveal(revealRequest.seq);
        const ancestors: string[] = [];
        for (
            let parent = data.getObject(revealRequest.id)?.parent;
            parent;
            parent = data.getObject(parent)?.parent
        ) {
            ancestors.push(parent);
        }
        if (ancestors.length > 0) setExpanded((prev) => new Set([...prev, ...ancestors]));
    }
    const scrolledReveal = useRef(revealRequest?.seq ?? 0);

    // Виртуализация: рисуются только строки в окне прокрутки плюс небольшой запас
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

    useEffect(() => {
        if (!revealRequest || revealRequest.seq === scrolledReveal.current) return;
        const index = rows.findIndex((r) => r.object.id === revealRequest.id);
        if (index < 0) return;
        scrolledReveal.current = revealRequest.seq;
        const top = index * ROW_HEIGHT;
        const element = containerRef.current;
        if (
            element &&
            (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + viewport)
        ) {
            element.scrollTop = top; // событие прокрутки обновит окно виртуализации
        }
    }, [revealRequest, rows, viewport]);

    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);

    const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const launcher = useActionLauncher();

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

    // Перенос перетаскиванием: тянем строку, цель и положение берём из позиции указателя
    const [drag, setDrag] = useState<{
        id: string;
        target: string | null;
        position: DropPosition;
        valid: boolean;
    } | null>(null);
    const siblingsOf = (parent: string | null) =>
        visibleChildren(data, parent).map((c) => c.object);

    const moveTo = async (id: string, target: string, position: DropPosition) => {
        const plan = planMove(data, siblingsOf, id, target, position);
        if (!plan.ok) return;
        setError(null);
        const result = await data.move(id, { parent: plan.parent, order: plan.order });
        if (!result.ok) setError(result.error);
        else if (plan.parent !== null) setExpanded((prev) => new Set(prev).add(plan.parent!));
    };

    /**
     * Alt+стрелки: то же, что перетаскивание, — порядок среди соседей, вложение и вынос
     */
    const onMoveKey = (e: ReactKeyboardEvent, object: DataObject) => {
        if (!e.altKey) return;
        const siblings = siblingsOf(object.parent);
        const index = siblings.findIndex((s) => s.id === object.id);
        const steps: Record<string, [DataObject | null | undefined, DropPosition]> = {
            ArrowUp: [siblings[index - 1], 'before'],
            ArrowDown: [siblings[index + 1], 'after'],
            ArrowRight: [siblings[index - 1], 'inside'],
            ArrowLeft: [object.parent === null ? null : data.getObject(object.parent), 'after'],
        };
        const step = steps[e.key];
        if (!step) return;
        e.preventDefault();
        const [target, position] = step;
        if (target) void moveTo(object.id, target.id, position);
    };

    const menuObject = menu ? data.getObject(menu.id) : undefined;
    const creatable = menuObject ? creatableTypes(data, menuObject) : [];
    const menuActions = menuObject ? data.getActions(menuObject.id, 'contextMenu') : [];
    const deletingObject = deleting ? data.getObject(deleting) : undefined;

    return (
        <>
            {(error ?? launcher.error) && <p role="alert">{error ?? launcher.error}</p>}
            {launcher.dialog}
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
                        const { paletteColor, cssColor } = colorPresentation(
                            resolveRuleColor(
                                data.getType(object.type)?.colorRules,
                                object.properties,
                            ),
                        );
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
                                data-rule-color={paletteColor}
                                style={{
                                    color: cssColor,
                                    position: 'absolute',
                                    top: (first + i) * ROW_HEIGHT,
                                    height: ROW_HEIGHT,
                                    left: 0,
                                    right: 0,
                                    paddingLeft: `${(level - 1) * 16}px`,
                                }}
                                draggable
                                tabIndex={
                                    selectedId === object.id ||
                                    (selectedId === null && first + i === 0)
                                        ? 0
                                        : -1
                                }
                                onKeyDown={(e) => onMoveKey(e, object)}
                                aria-disabled={
                                    drag?.target === object.id && !drag.valid ? true : undefined
                                }
                                data-drop={
                                    drag?.target === object.id && drag.valid
                                        ? drag.position
                                        : undefined
                                }
                                onDragStart={(e) => {
                                    e.dataTransfer?.setData('text/plain', object.id);
                                    setDrag({
                                        id: object.id,
                                        target: null,
                                        position: 'inside',
                                        valid: false,
                                    });
                                }}
                                onDragOver={(e) => {
                                    if (!drag) return;
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const position = positionInRow(
                                        e.clientY - rect.top,
                                        ROW_HEIGHT,
                                    );
                                    const valid = planMove(
                                        data,
                                        siblingsOf,
                                        drag.id,
                                        object.id,
                                        position,
                                    ).ok;
                                    if (valid) e.preventDefault();
                                    if (e.dataTransfer) {
                                        e.dataTransfer.dropEffect = valid ? 'move' : 'none';
                                    }
                                    if (
                                        drag.target !== object.id ||
                                        drag.position !== position ||
                                        drag.valid !== valid
                                    ) {
                                        setDrag({ ...drag, target: object.id, position, valid });
                                    }
                                }}
                                onDrop={(e) => {
                                    if (!drag) return;
                                    e.preventDefault();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const position = positionInRow(
                                        e.clientY - rect.top,
                                        ROW_HEIGHT,
                                    );
                                    const id = drag.id;
                                    setDrag(null);
                                    void moveTo(id, object.id, position);
                                }}
                                onDragEnd={() => setDrag(null)}
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
                                        <ChevronIcon open={isOpen} />
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
                    {menuActions.map((action) => (
                        <li key={action.id} role="none">
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    setError(null);
                                    void launcher.launch(menuObject.id, action);
                                }}
                            >
                                {action.name}
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
