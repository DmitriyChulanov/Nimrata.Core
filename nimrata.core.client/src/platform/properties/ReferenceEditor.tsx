import { useState } from 'react';

import { useObject } from '@platform/data/useObject';
import { objectLabel } from '@platform/objectQueries/objectQueries';
import { useSelection } from '@platform/selection/useSelection';
import { ObjectTreePicker } from '@platform/tree/ObjectTreePicker';
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
    const targets = property.targetTypes;
    const allowed = (object: DataObject) => !targets || targets.includes(object.type);

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
            <ObjectTreePicker
                data={data}
                label="Объекты"
                isAllowed={allowed}
                selected={chosen}
                onSelect={setChosen}
                onConfirm={onPick}
            />
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
