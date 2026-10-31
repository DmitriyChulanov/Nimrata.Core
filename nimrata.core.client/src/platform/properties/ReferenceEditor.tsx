import { useState } from 'react';

import { useObject } from '@platform/data/useObject';
import { Icon } from '@platform/icons/Icon';
import { objectLabel } from '@platform/objectQueries/objectQueries';
import { useSelection } from '@platform/selection/useSelection';
import { flatten } from '@platform/tree/treeModel';
import { TypeIcon } from '@platform/tree/TypeIcon';
import { Button, Dialog, IconButton } from '@platform/ui';

import type { DataController, DataObject } from '@platform/data/DataController';
import type { PropertyDefinition } from '@platform/types/types';

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

    const items = flatten(data, expanded);

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
    // Подписка на цель: её переименование обновляет подпись, даже если таблица не перерисовывалась
    const target = useObject(id);
    const text = mixed
        ? 'Различны'
        : !id
          ? '—'
          : target
            ? objectLabel(data, target)
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
