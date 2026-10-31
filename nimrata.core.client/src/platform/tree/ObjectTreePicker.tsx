import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { Icon } from '@platform/icons/Icon';

import './ObjectTreePicker.css';
import { expandToReveal, flatten } from './treeModel';
import { TypeIcon } from './TypeIcon';

import type { DataController, DataObject } from '@platform/data/DataController';

/**
 * Свойства панели выбора объекта в дереве
 */
export interface ObjectTreePickerProps {
    /** Контроллер данных */
    data: DataController;
    /** Подпись дерева для вспомогательных технологий */
    label: string;
    /** Родитель, чьи потомки показываются первым уровнем; `null` — всё дерево */
    rootId?: string | null;
    /** Можно ли выбрать объект; недопустимые узлы показываются приглушёнными и не подтверждаются */
    isAllowed?: (object: DataObject) => boolean;
    /** Выбранный объект; дерево раскрывается до него при показе */
    selected: string | null;
    /** Выбор узла (щелчок, пробел); допустимость узла проверяет вызывающий */
    onSelect: (id: string) => void;
    /** Подтверждение допустимого узла (двойной щелчок, Enter) */
    onConfirm?: (id: string) => void;
}

/**
 * Панель выбора объекта в дереве: сворачивание и разворачивание узлов, клавиатура по шаблону
 * ARIA tree (стрелки, `Home`, `End`, `Enter`, пробел). При показе раскрывает предков выбранного
 * объекта и прокручивает его в видимую область
 *
 * @param props - данные, корень, допустимость, выбор и подтверждение
 * @returns дерево фиксированной высоты с прокруткой
 */
export function ObjectTreePicker({
    data,
    label,
    rootId = null,
    isAllowed,
    selected,
    onSelect,
    onConfirm,
}: ObjectTreePickerProps) {
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() =>
        selected ? expandToReveal(data, new Set(), selected) : new Set(),
    );
    const [active, setActive] = useState<string | null>(selected);
    const treeRef = useRef<HTMLDivElement>(null);
    const rows = useMemo(() => flatten(data, expanded, rootId), [data, expanded, rootId]);
    const allowed = (object: DataObject) => !isAllowed || isAllowed(object);
    const activeId = rows.some((r) => r.object.id === active) ? active : (rows[0]?.object.id ?? null);

    // Выбранный при показе узел виден без прокрутки пользователем
    useEffect(() => {
        const row = treeRef.current?.querySelector('[aria-selected="true"]');
        if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
            row.scrollIntoView({ block: 'nearest' });
        }
    }, []);

    const toggle = (id: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (!next.delete(id)) next.add(id);
            return next;
        });

    const focusRow = (id: string) => {
        setActive(id);
        const row = treeRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (row instanceof HTMLElement) row.focus();
    };

    const confirm = (object: DataObject) => {
        if (allowed(object)) onConfirm?.(object.id);
    };

    const onKeyDown = (event: KeyboardEvent) => {
        const index = rows.findIndex((r) => r.object.id === activeId);
        const current = rows[index];
        if (!current) return;
        const { object, hasChildren, level } = current;
        const open = expanded.has(object.id);
        let handled = true;
        switch (event.key) {
            case 'ArrowDown':
                if (rows[index + 1]) focusRow(rows[index + 1].object.id);
                break;
            case 'ArrowUp':
                if (rows[index - 1]) focusRow(rows[index - 1].object.id);
                break;
            case 'Home':
                focusRow(rows[0].object.id);
                break;
            case 'End':
                focusRow(rows[rows.length - 1].object.id);
                break;
            case 'ArrowRight':
                if (hasChildren && !open) toggle(object.id);
                else if (hasChildren && rows[index + 1]) focusRow(rows[index + 1].object.id);
                break;
            case 'ArrowLeft':
                if (hasChildren && open) toggle(object.id);
                else {
                    const parent = rows
                        .slice(0, index)
                        .reverse()
                        .find((r) => r.level < level);
                    if (parent) focusRow(parent.object.id);
                }
                break;
            case ' ':
                onSelect(object.id);
                break;
            case 'Enter':
                onSelect(object.id);
                confirm(object);
                break;
            default:
                handled = false;
        }
        if (handled) event.preventDefault();
    };

    return (
        <div
            ref={treeRef}
            role="tree"
            aria-label={label}
            className="object-tree-picker"
            onKeyDown={onKeyDown}
        >
            {rows.map(({ object, title, level, hasChildren }) => {
                const isOpen = expanded.has(object.id);
                return (
                    <div
                        key={object.id}
                        role="treeitem"
                        data-id={object.id}
                        aria-label={title}
                        aria-level={level}
                        aria-selected={selected === object.id}
                        aria-disabled={allowed(object) ? undefined : true}
                        aria-expanded={hasChildren ? isOpen : undefined}
                        tabIndex={object.id === activeId ? 0 : -1}
                        className="object-tree-picker__item"
                        style={{ paddingLeft: `calc(var(--space-4) * ${level - 1})` }}
                        onClick={() => {
                            setActive(object.id);
                            onSelect(object.id);
                        }}
                        onDoubleClick={() => confirm(object)}
                        onFocus={(e) => {
                            if (e.target === e.currentTarget) setActive(object.id);
                        }}
                    >
                        {hasChildren ? (
                            <button
                                type="button"
                                tabIndex={-1}
                                className="object-tree-picker__toggle"
                                aria-label={isOpen ? 'Свернуть' : 'Развернуть'}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggle(object.id);
                                }}
                                onDoubleClick={(e) => e.stopPropagation()}
                            >
                                <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />
                            </button>
                        ) : (
                            <span className="object-tree-picker__toggle" aria-hidden="true" />
                        )}
                        <TypeIcon type={data.getType(object.type)} />
                        <span>{title}</span>
                    </div>
                );
            })}
        </div>
    );
}
