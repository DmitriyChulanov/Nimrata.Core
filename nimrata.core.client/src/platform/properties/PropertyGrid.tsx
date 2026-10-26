import { useId, useRef, useState } from 'react';

import { useActionLauncher } from '@platform/actions/useActionLauncher';
import { useData } from '@platform/data/useData';
import { useSelection } from '@platform/selection/useSelection';

import { ReferenceEditor } from './ReferenceEditor';
import './PropertyGrid.css';

import type { ReactNode } from 'react';
import type { DataController } from '@platform/data/DataController';
import type { PropertyDefinition } from '@platform/types/types';

/**
 * Название категории для свойств без категории
 */
const OTHER_CATEGORY = 'Прочее';

/**
 * Результат разбора введённого текста: значение (`null` — очистить) либо причина отказа
 */
type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Разбирает введённый текст по виду свойства
 *
 * @param property - описание свойства
 * @param text - введённый текст
 * @returns значение для записи (`null` — очистить) либо причина отказа
 */
function parseInput(property: PropertyDefinition, text: string): Parsed {
    if (text.trim() === '') return { ok: true, value: null };
    switch (property.kind) {
        case 'integer': {
            const trimmed = text.trim();
            if (!/^-?\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
                return { ok: false, error: `${property.name}: введите целое число.` };
            }
            return { ok: true, value: Number(trimmed) };
        }
        case 'date':
            return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text))
                ? { ok: true, value: text }
                : { ok: false, error: `${property.name}: введите дату в формате ГГГГ-ММ-ДД.` };
        case 'time':
            return /^([01]\d|2[0-3]):[0-5]\d$/.test(text)
                ? { ok: true, value: text }
                : { ok: false, error: `${property.name}: введите время в формате ЧЧ:мм.` };
        default:
            return { ok: true, value: text };
    }
}

/**
 * Текст значения для поля ввода
 *
 * @param value - значение свойства
 * @returns строка; пустая, если значения нет
 */
function toText(value: unknown): string {
    return value === undefined || value === null ? '' : String(value);
}

/**
 * Группирует свойства по категориям; «Прочее» всегда последней
 *
 * @param properties - свойства типа
 * @returns пары название категории и её свойства
 */
function groupByCategory(properties: PropertyDefinition[]) {
    const groups = new Map<string, PropertyDefinition[]>();
    for (const p of properties) {
        const category = p.category || OTHER_CATEGORY;
        const list = groups.get(category);
        if (list) list.push(p);
        else groups.set(category, [p]);
    }
    // «Прочее» всегда последним, остальные категории — в порядке появления в описании типа
    const other = groups.get(OTHER_CATEGORY);
    groups.delete(OTHER_CATEGORY);
    if (other) groups.set(OTHER_CATEGORY, other);
    return [...groups];
}

/**
 * Общие свойства редакторов значения
 */
interface EditorProps {
    /** Описание редактируемого свойства */
    property: PropertyDefinition;
    /** Текущее значение свойства */
    value: unknown;
    /** Запрещено ли редактирование */
    disabled: boolean;
    /** Идентификатор элемента ввода для связи с подписью */
    inputId: string;
    /** Отправляет значение; возвращает `false`, если оно отклонено */
    onCommit: (value: unknown) => Promise<boolean>;
    /** Сообщает о некорректном вводе */
    onInvalid: (message: string) => void;
}

/**
 * Строка, многострочный текст, целое, дата, время: правка черновика, отправка по Enter или уходу фокуса
 */
function TextEditor({ property, value, disabled, inputId, onCommit, onInvalid }: EditorProps) {
    const [draft, setDraft] = useState<string | null>(null);
    const submitted = useRef<string | null>(null);
    const multiline = property.kind === 'text';
    const text = draft ?? toText(value);

    async function commit() {
        if (draft === null || draft === submitted.current) return;
        if (draft === toText(value)) {
            setDraft(null);
            return;
        }
        const parsed = parseInput(property, draft);
        if (!parsed.ok) {
            onInvalid(parsed.error);
            return;
        }
        submitted.current = draft;
        await onCommit(parsed.value);
        // Успех: в модели новое значение; отказ: модель откатилась, поле возвращается к ней
        submitted.current = null;
        setDraft(null);
    }

    const common = {
        id: inputId,
        value: text,
        disabled,
        onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
        onBlur: () => void commit(),
    };

    if (multiline) return <textarea {...common} rows={3} />;

    const type = property.kind === 'date' ? 'date' : property.kind === 'time' ? 'time' : 'text';
    return (
        <input
            {...common}
            type={type}
            inputMode={property.kind === 'integer' ? 'numeric' : undefined}
            onKeyDown={(e) => {
                if (e.key === 'Enter') void commit();
                if (e.key === 'Escape') setDraft(null);
            }}
        />
    );
}

/**
 * Выбирает редактор по виду свойства
 *
 * @param props - свойства редактора и контроллер данных
 * @returns редактор значения
 */
function PropertyEditor(props: EditorProps & { data: DataController }) {
    const { property, value, disabled, inputId, onCommit, data } = props;

    switch (property.kind) {
        case 'boolean':
            return (
                <input
                    id={inputId}
                    type="checkbox"
                    checked={value === true}
                    disabled={disabled}
                    onChange={(e) => void onCommit(e.target.checked)}
                />
            );
        case 'enum':
            return (
                <select
                    id={inputId}
                    value={toText(value)}
                    disabled={disabled}
                    onChange={(e) => void onCommit(e.target.value === '' ? null : e.target.value)}
                >
                    <option value=""></option>
                    {(property.values ?? []).map((v) => (
                        <option key={v.value} value={v.value}>
                            {v.name}
                        </option>
                    ))}
                </select>
            );
        case 'reference':
            return (
                <ReferenceEditor
                    data={data}
                    property={property}
                    value={value}
                    disabled={disabled}
                    onCommit={onCommit}
                />
            );
        default:
            return <TextEditor {...props} />;
    }
}

/**
 * Строка таблицы свойств: подпись и редактор
 *
 * @param props - свойство, значение, контроллер данных и обработчики
 * @returns строка таблицы
 */
function Row({
    property,
    value,
    data,
    onCommit,
    onInvalid,
}: {
    property: PropertyDefinition;
    value: unknown;
    data: DataController;
    onCommit: (value: unknown) => Promise<boolean>;
    onInvalid: (message: string) => void;
}) {
    const inputId = useId();
    const disabled = property.readOnly === true;
    const label: ReactNode =
        property.kind === 'reference' ? (
            <span className="property-grid-label">{property.name}</span>
        ) : (
            <label className="property-grid-label" htmlFor={inputId}>
                {property.name}
            </label>
        );
    return (
        <div className="property-grid-row">
            {label}
            <PropertyEditor
                property={property}
                value={value}
                disabled={disabled}
                inputId={inputId}
                onCommit={onCommit}
                onInvalid={onInvalid}
                data={data}
            />
        </div>
    );
}

/**
 * Таблица свойств выбранного объекта: категории, редакторы по виду свойства, правка наборами изменений
 */
export function PropertyGrid() {
    const data = useData();
    const { selectedId } = useSelection();
    const [error, setError] = useState<string | null>(null);
    const launcher = useActionLauncher();

    const object = selectedId ? data.getObject(selectedId) : undefined;
    if (!object) return <p>Объект не выбран.</p>;

    const type = data.getType(object.type);
    const groups = groupByCategory((type?.properties ?? []).filter((p) => !p.hidden));
    const actions = data.getActions(object.id, 'propertyGrid');
    const shownError = error ?? launcher.error;

    async function commit(property: PropertyDefinition, value: unknown): Promise<boolean> {
        setError(null);
        const result = await data.setProperty(object!.id, property.id, value);
        if (!result.ok) setError(result.error);
        return result.ok;
    }

    return (
        <div className="property-grid">
            <h2>{type?.name ?? object.type}</h2>
            {shownError && <p role="alert">{shownError}</p>}
            {actions.length > 0 && (
                <div role="toolbar" aria-label="Действия" className="property-grid-actions">
                    {actions.map((action) => (
                        <button
                            key={action.id}
                            type="button"
                            onClick={() => {
                                setError(null);
                                void launcher.launch(object.id, action);
                            }}
                        >
                            {action.name}
                        </button>
                    ))}
                </div>
            )}
            {launcher.dialog}
            {groups.map(([category, properties]) => (
                <section key={category} role="group" aria-label={category}>
                    <h3>{category}</h3>
                    {properties.map((property) => (
                        <Row
                            key={`${object.id}:${property.id}`}
                            property={property}
                            value={object.properties[property.id]}
                            data={data}
                            onCommit={(value) => commit(property, value)}
                            onInvalid={setError}
                        />
                    ))}
                </section>
            ))}
        </div>
    );
}
