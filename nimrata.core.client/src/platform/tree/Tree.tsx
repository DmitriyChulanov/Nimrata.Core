import { useEffect, useMemo, useRef, useState } from 'react';

import { useActionLauncher } from '@platform/actions/useActionLauncher';
import { useData } from '@platform/data/useData';
import { Icon } from '@platform/icons/Icon';
import { objectLabel } from '@platform/objectQueries/objectQueries';
import { Button, ContextMenu, Dialog } from '@platform/ui';

import { TypeIcon } from './TypeIcon';
import { useSelection } from '@platform/selection/useSelection';

import { canPaste, copySubtrees, pasteSubtrees, topLevelIds } from './clipboard';
import { planMove, positionInRow } from './planMove';
import { expandToReveal, flatten, visibleChildren } from './treeModel';
import { colorPresentation, resolveRuleColor } from './colorRules';
import './ruleColors.css';

import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { DataController, DataObject } from '@platform/data/DataController';
import type { ContextMenuSeparator, MenuEntry } from '@platform/ui';
import type { ActionDefinition, TypeDefinition } from '@platform/types/types';
import type { ClipboardNode } from './clipboard';
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
 * Типы, объекты которых можно создать под узлом: допустимые дочерние неабстрактные типы
 */
function creatableTypes(data: DataController, parent: DataObject): TypeDefinition[] {
    const allowed = data.getType(parent.type)?.allowedChildren ?? [];
    return allowed
        .map((id) => data.getType(id))
        .filter((t): t is TypeDefinition => t !== undefined && !t.abstract);
}

/**
 * Универсальное дерево: строится по типам и объектам `DataController`, не зная о расширениях
 */
export function Tree() {
    const data = useData();
    const { selectedId, selectedIds, select, setSelection, reveal, revealRequest } = useSelection();
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    // Опорная строка для выделения диапазона Shift+клик
    const anchor = useRef<string | null>(null);
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
        setExpanded((prev) => expandToReveal(data, prev, revealRequest.id));
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

    // Меню открыто для группы `ids` (одиночный объект — группа из одного)
    const [menu, setMenu] = useState<{ ids: string[]; x: number; y: number } | null>(null);
    const [deleting, setDeleting] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Внутренний буфер обмена: живёт, пока открыто приложение
    const [clipboard, setClipboard] = useState<ClipboardNode[]>([]);
    const launcher = useActionLauncher();

    const createChild = async (parent: string, type: string) => {
        setError(null);
        const result = await data.create({ type, parent });
        if (result.ok) {
            setExpanded((prev) => new Set(prev).add(parent));
            reveal(result.id);
        } else setError(result.error);
    };

    const copySelection = (ids: readonly string[]) => {
        const nodes = copySubtrees(data, ids);
        if (nodes.length > 0) setClipboard(nodes);
    };

    const pasteInto = async (target: string) => {
        if (!canPaste(data, clipboard, target)) return;
        setError(null);
        const result = await pasteSubtrees(data, clipboard, target);
        if (!result.ok) {
            setError(result.error);
            return;
        }
        setExpanded((prev) => new Set(prev).add(target));
        reveal(result.ids[0], result.ids);
    };

    const confirmDelete = async (ids: readonly string[]) => {
        setDeleting(null);
        setError(null);
        const result = await data.perform((tx) => {
            for (const id of ids) {
                const removed = tx.remove(id);
                if (!removed.ok) throw new Error(removed.error);
            }
        });
        if (!result.ok) {
            setError(result.error);
            return;
        }
        const alive = selectedIds.filter((id) => data.getObject(id));
        if (alive.length !== selectedIds.length) {
            setSelection(alive, selectedId && alive.includes(selectedId) ? selectedId : null);
        }
    };

    const selectRow = (e: ReactMouseEvent, id: string) => {
        if (e.shiftKey && anchor.current && rows.some((r) => r.object.id === anchor.current)) {
            const from = rows.findIndex((r) => r.object.id === anchor.current);
            const to = rows.findIndex((r) => r.object.id === id);
            const [lo, hi] = from < to ? [from, to] : [to, from];
            setSelection(
                rows.slice(lo, hi + 1).map((r) => r.object.id),
                id,
            );
            return;
        }
        anchor.current = id;
        if (e.ctrlKey || e.metaKey) {
            if (!selectedSet.has(id)) {
                setSelection([...selectedIds, id], id);
            } else {
                const rest = selectedIds.filter((s) => s !== id);
                setSelection(
                    rest,
                    id === selectedId ? (rest[rest.length - 1] ?? null) : selectedId,
                );
            }
            return;
        }
        select(id);
    };

    /**
     * Ctrl/Cmd+C, +V, +A и Delete; клавиши сверяются по физическому коду, чтобы работать в любой раскладке
     */
    const onTreeKey = (e: ReactKeyboardEvent) => {
        if (e.altKey) return;
        const mod = e.ctrlKey || e.metaKey;
        // Синтетические события без `code` распознаются по символу
        const code = e.code || `Key${e.key.toUpperCase()}`;
        if (mod && code === 'KeyA') {
            e.preventDefault();
            setSelection(
                rows.map((r) => r.object.id),
                selectedId ?? rows[0]?.object.id ?? null,
            );
        } else if (mod && code === 'KeyC') {
            e.preventDefault();
            copySelection(selectedIds);
        } else if (mod && code === 'KeyV') {
            e.preventDefault();
            if (selectedIds.length === 1) void pasteInto(selectedIds[0]);
        } else if (e.key === 'Delete' && !mod) {
            e.preventDefault();
            const top = topLevelIds(data, selectedIds);
            if (top.length > 0) setDeleting(top);
        }
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

    const deletingObjects = (deleting ?? []).flatMap((id) => data.getObject(id) ?? []);

    /**
     * Пункты контекстного меню группы: «Создать», «Копировать» и «Вставить» (создание и вставка — только
     * для одного узла), затем действия типа, затем «Удалить»; группы разделены чертой
     */
    const buildMenuItems = (ids: readonly string[]): (MenuEntry | ContextMenuSeparator)[] => {
        const targets = ids.flatMap((id) => data.getObject(id) ?? []);
        if (targets.length === 0) return [];
        const single = targets.length === 1 ? targets[0] : null;

        const edit: MenuEntry[] = [];
        if (single) {
            for (const type of creatableTypes(data, single)) {
                edit.push({
                    id: `create:${type.id}`,
                    label: `Создать: ${type.name}`,
                    icon: 'plus',
                    onSelect: () => void createChild(single.id, type.id),
                });
            }
        }
        edit.push({
            id: 'copy',
            label: 'Копировать',
            icon: 'copy',
            onSelect: () => copySelection(ids),
        });
        if (single) {
            edit.push({
                id: 'paste',
                label: 'Вставить',
                icon: 'clipboard',
                disabled: !canPaste(data, clipboard, single.id),
                onSelect: () => void pasteInto(single.id),
            });
        }

        // Действие доступно группе, если оно есть у каждого выделенного объекта
        const [firstTarget, ...others] = targets;
        const common: ActionDefinition[] = data
            .getActions(firstTarget.id, 'contextMenu')
            .filter((action) =>
                others.every((o) =>
                    data.getActions(o.id, 'contextMenu').some((a) => a.id === action.id),
                ),
            );
        const actions: MenuEntry[] = common.map((action) => ({
            id: `action:${action.id}`,
            label: action.name,
            icon: action.icon ?? 'play',
            onSelect: () => {
                setError(null);
                void launcher.launchMany(
                    targets.map((t) => t.id),
                    action,
                );
            },
        }));

        const remove: MenuEntry = {
            id: 'delete',
            label: 'Удалить',
            icon: 'trash-2',
            danger: true,
            onSelect: () => setDeleting(topLevelIds(data, ids)),
        };

        const items: (MenuEntry | ContextMenuSeparator)[] = [];
        [edit, actions, [remove]].forEach((group, n) => {
            if (group.length === 0) return;
            if (items.length > 0) items.push({ id: `separator:${n}`, separator: true });
            items.push(...group);
        });
        return items;
    };
    const menuItems = menu ? buildMenuItems(menu.ids) : [];

    return (
        <>
            {(error ?? launcher.error) && <p role="alert">{error ?? launcher.error}</p>}
            {launcher.dialog}
            <div
                ref={containerRef}
                role="tree"
                aria-label="Дерево объектов"
                aria-multiselectable="true"
                onKeyDown={onTreeKey}
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
                                aria-selected={selectedSet.has(object.id)}
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
                                onClick={(e) => selectRow(e, object.id)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    // Правый клик внутри выделения работает на всю группу, вне — на один узел
                                    const inGroup = selectedSet.has(object.id);
                                    if (!inGroup) {
                                        anchor.current = object.id;
                                        select(object.id);
                                    }
                                    setMenu({
                                        ids: inGroup ? [...selectedIds] : [object.id],
                                        x: e.clientX,
                                        y: e.clientY,
                                    });
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
                                        <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />
                                    </button>
                                ) : (
                                    <span aria-hidden="true" />
                                )}
                                <TypeIcon type={data.getType(object.type)} />
                                <span>{title}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
            {menu && menuItems.length > 0 && (
                <ContextMenu
                    label="Действия с объектом"
                    x={menu.x}
                    y={menu.y}
                    items={menuItems}
                    onClose={() => setMenu(null)}
                />
            )}
            {deletingObjects.length > 0 && (
                <Dialog
                    title="Подтверждение удаления"
                    role="alertdialog"
                    onClose={() => setDeleting(null)}
                    actions={
                        <>
                            <Button onClick={() => setDeleting(null)}>Отмена</Button>
                            <Button
                                variant="danger"
                                onClick={() => void confirmDelete(deletingObjects.map((o) => o.id))}
                            >
                                Удалить
                            </Button>
                        </>
                    }
                >
                    <p>
                        {deletingObjects.length === 1
                            ? `Удалить «${objectLabel(data, deletingObjects[0])}» вместе со всеми вложенными объектами?`
                            : `Удалить выделенные объекты (${deletingObjects.length}) вместе со всеми вложенными объектами?`}
                    </p>
                </Dialog>
            )}
        </>
    );
}
