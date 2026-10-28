import { useState } from 'react';

import { collator } from '@platform/collator';
import { Icon } from '@platform/icons/Icon';
import { useSelection } from '@platform/selection/useSelection';
import { TypeIcon } from '@platform/tree/TypeIcon';
import { Button, Dialog, IconButton } from '@platform/ui';

import type { DataController, DataObject } from '@platform/data/DataController';
import type { PropertyDefinition } from '@platform/types/types';

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
        <Dialog
            title={`Выбор объекта: ${property.name}`}
            onClose={onCancel}
            actions={
                <>
                    <Button onClick={onCancel}>Отмена</Button>
                    <Button
                        variant="primary"
                        disabled={!canConfirm}
                        onClick={() => chosen && onPick(chosen)}
                    >
                        Выбрать
                    </Button>
                </>
            }
        >
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
        </Dialog>
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
    /** У выделенных объектов цели разные: вместо названия показывается «Различны» */
    mixed?: boolean;
    /** Запрещено ли редактирование */
    disabled: boolean;
    /** Отправляет новое значение; возвращает `false`, если оно отклонено */
    onCommit: (value: unknown) => Promise<boolean>;
}

/**
 * Редактор ссылки на объект: название цели, выбор в диалоге, очистка и переход к цели в дереве
 */
export function ReferenceEditor({
    data,
    property,
    value,
    mixed = false,
    disabled,
    onCommit,
}: EditorProps) {
    const { reveal } = useSelection();
    const [picking, setPicking] = useState(false);

    const id = !mixed && typeof value === 'string' && value !== '' ? value : null;
    const target = id ? data.getObject(id) : undefined;
    const text = mixed
        ? 'Различны'
        : !id
          ? '—'
          : target
            ? titleOf(data, target)
            : 'Недоступный объект';

    return (
        <div className="property-grid-reference">
            <span
                className={id && !target ? 'property-grid-readonly property-grid-unavailable' : ''}
            >
                {text}
            </span>
            <IconButton
                icon="search"
                label={`Выбрать: ${property.name}`}
                disabled={disabled}
                onClick={() => setPicking(true)}
            />
            <IconButton
                icon="arrow-right"
                label={`Перейти: ${property.name}`}
                disabled={!target}
                onClick={() => id && reveal(id)}
            />
            <IconButton
                icon="x"
                label={`Очистить: ${property.name}`}
                disabled={disabled || (!id && !mixed)}
                onClick={() => void onCommit(null)}
            />
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
