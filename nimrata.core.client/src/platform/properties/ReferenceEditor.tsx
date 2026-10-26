import { useState } from 'react';

import { useSelection } from '@platform/selection/useSelection';

import type { DataController, DataObject } from '@platform/data/DataController';
import type { PropertyDefinition } from '@platform/types/types';

/**
 * Сравнение названий по правилам русского языка
 */
const collator = new Intl.Collator('ru');

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
 * Потомки родителя, видимые в дереве, в порядке показа
 *
 * @param data - контроллер данных
 * @param parent - идентификатор родителя; `null` — корень
 * @returns объекты с названиями
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
 * Свойства диалога выбора цели ссылки
 */
interface PickerProps {
    /** Контроллер данных */
    data: DataController;
    /** Описание ссылочного свойства */
    property: PropertyDefinition;
    /** Текущая цель; `null`, если ссылки нет */
    current: string | null;
    /** Подтверждает выбор цели */
    onPick: (id: string) => void;
    /** Закрывает диалог без выбора */
    onCancel: () => void;
}

/**
 * Диалог выбора цели ссылки: дерево объектов, недопустимые по `targetTypes` узлы отключены
 */
function ReferencePicker({ data, property, current, onPick, onCancel }: PickerProps) {
    const [chosen, setChosen] = useState<string | null>(current);
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const targets = property.targetTypes;
    const allowed = (object: DataObject) => !targets || targets.includes(object.type);

    const toggle = (id: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (!next.delete(id)) next.add(id);
            return next;
        });

    const items: { object: DataObject; title: string; level: number; hasChildren: boolean }[] = [];
    const walk = (parent: string | null, level: number) => {
        for (const { object, title } of visibleChildren(data, parent)) {
            const hasChildren = visibleChildren(data, object.id).length > 0;
            items.push({ object, title, level, hasChildren });
            if (hasChildren && expanded.has(object.id)) walk(object.id, level + 1);
        }
    };
    walk(null, 1);

    const chosenObject = chosen ? data.getObject(chosen) : undefined;
    const canConfirm = chosenObject !== undefined && allowed(chosenObject);

    return (
        <div role="dialog" aria-modal="true" aria-label={`Выбор объекта: ${property.name}`}>
            <div role="tree" aria-label="Объекты">
                {items.map(({ object, title, level, hasChildren }) => {
                    const isOpen = expanded.has(object.id);
                    return (
                        <div
                            key={object.id}
                            role="treeitem"
                            aria-label={title}
                            aria-level={level}
                            aria-selected={chosen === object.id}
                            aria-disabled={allowed(object) ? undefined : true}
                            aria-expanded={hasChildren ? isOpen : undefined}
                            style={{ paddingLeft: `${(level - 1) * 16}px` }}
                            onClick={() => setChosen(object.id)}
                            onDoubleClick={() => allowed(object) && onPick(object.id)}
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
                            <span aria-hidden="true">{data.getType(object.type)?.icon ?? '•'}</span>
                            <span>{title}</span>
                        </div>
                    );
                })}
            </div>
            <button type="button" disabled={!canConfirm} onClick={() => chosen && onPick(chosen)}>
                Выбрать
            </button>
            <button type="button" onClick={onCancel}>
                Отмена
            </button>
        </div>
    );
}

/**
 * Свойства компонента `ReferenceEditor`
 */
interface EditorProps {
    /** Контроллер данных */
    data: DataController;
    /** Описание ссылочного свойства */
    property: PropertyDefinition;
    /** Текущее значение: идентификатор цели */
    value: unknown;
    /** Запрещено ли редактирование */
    disabled: boolean;
    /** Отправляет новое значение; возвращает `false`, если оно отклонено */
    onCommit: (value: unknown) => Promise<boolean>;
}

/**
 * Редактор ссылки на объект: название цели, выбор в диалоге, очистка и переход к цели в дереве
 */
export function ReferenceEditor({ data, property, value, disabled, onCommit }: EditorProps) {
    const { reveal } = useSelection();
    const [picking, setPicking] = useState(false);

    const id = typeof value === 'string' && value !== '' ? value : null;
    const target = id ? data.getObject(id) : undefined;
    const text = !id ? '—' : target ? titleOf(data, target) : 'Недоступный объект';

    return (
        <div className="property-grid-reference">
            <span
                className={id && !target ? 'property-grid-readonly property-grid-unavailable' : ''}
            >
                {text}
            </span>
            <button
                type="button"
                aria-label={`Выбрать: ${property.name}`}
                disabled={disabled}
                onClick={() => setPicking(true)}
            >
                …
            </button>
            <button
                type="button"
                aria-label={`Перейти: ${property.name}`}
                disabled={!target}
                onClick={() => id && reveal(id)}
            >
                →
            </button>
            <button
                type="button"
                aria-label={`Очистить: ${property.name}`}
                disabled={disabled || !id}
                onClick={() => void onCommit(null)}
            >
                ×
            </button>
            {picking && (
                <ReferencePicker
                    data={data}
                    property={property}
                    current={id}
                    onPick={(picked) => {
                        setPicking(false);
                        void onCommit(picked);
                    }}
                    onCancel={() => setPicking(false)}
                />
            )}
        </div>
    );
}
