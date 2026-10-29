import { useId, useRef, useState } from 'react';

import { useActionLauncher } from '@platform/actions/useActionLauncher';
import { useData } from '@platform/data/useData';
import { useSelection } from '@platform/selection/useSelection';
import { Button } from '@platform/ui';

import { commonProperties, sortItems, toSections } from './gridModel';
import { ReferenceEditor } from './ReferenceEditor';
import './PropertyGrid.css';

import type { ReactNode } from 'react';
import type { DataController, DataObject } from '@platform/data/DataController';
import type { ActionDefinition, PropertyDefinition } from '@platform/types/types';
import type { CommonProperty, GridItem } from './gridModel';

/**
 * Текст значения, когда у выделенных объектов оно разное
 */
const MIXED_TEXT = 'Различны';

/**
 * Значение пункта списка «Различны»: не совпадает ни с одним значением перечисления
 */
const MIXED_OPTION = '\u0000mixed';

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
 * Общие свойства редакторов значения
 */
interface EditorProps {
    /** Описание редактируемого свойства */
    property: PropertyDefinition;
    /** Текущее значение свойства */
    value: unknown;
    /** У выделенных объектов значения разные: показывается «Различны», пока значение не выбрано */
    mixed: boolean;
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
function TextEditor({
    property,
    value,
    mixed,
    disabled,
    inputId,
    onCommit,
    onInvalid,
}: EditorProps) {
    const [draft, setDraft] = useState<string | null>(null);
    const submitted = useRef<string | null>(null);
    const multiline = property.kind === 'text';
    const text = draft ?? toText(value);

    async function commit() {
        if (draft === null || draft === submitted.current) return;
        if (!mixed && draft === toText(value)) {
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
        placeholder: mixed ? MIXED_TEXT : undefined,
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
    const { property, value, mixed, disabled, inputId, onCommit, data } = props;

    switch (property.kind) {
        case 'boolean':
            return (
                <span className="property-grid-boolean">
                    <input
                        id={inputId}
                        type="checkbox"
                        ref={(element) => {
                            if (element) element.indeterminate = mixed;
                        }}
                        checked={!mixed && value === true}
                        disabled={disabled}
                        onChange={(e) => void onCommit(e.target.checked)}
                    />
                    {mixed && <span className="property-grid-readonly">{MIXED_TEXT}</span>}
                </span>
            );
        case 'enum':
            return (
                <select
                    id={inputId}
                    value={mixed ? MIXED_OPTION : toText(value)}
                    disabled={disabled}
                    onChange={(e) => void onCommit(e.target.value === '' ? null : e.target.value)}
                >
                    {mixed && (
                        <option value={MIXED_OPTION} disabled>
                            {MIXED_TEXT}
                        </option>
                    )}
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
                    mixed={mixed}
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
    mixed,
    data,
    onCommit,
    onInvalid,
}: {
    property: PropertyDefinition;
    value: unknown;
    mixed: boolean;
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
                mixed={mixed}
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
 * Строка действий: подряд идущие кнопки по центру в одной строке, не влезающие переносятся
 */
function ActionRow({
    items,
    onLaunch,
}: {
    items: readonly Extract<GridItem, { kind: 'action' }>[];
    onLaunch: (action: ActionDefinition) => void;
}) {
    return (
        <div className="property-grid-action-row">
            {items.map(({ action, unavailable }) => (
                <Button
                    key={action.id}
                    icon={action.icon}
                    disabled={unavailable !== null}
                    title={unavailable ?? undefined}
                    onClick={() => onLaunch(action)}
                >
                    {action.name}
                </Button>
            ))}
        </div>
    );
}

/**
 * Таблица свойств выделенных объектов: сквозной порядок свойств и действий, категории, редакторы
 * по виду свойства. Для группы показаны общие свойства и действия; правка и запуск применяются ко всем
 */
export function PropertyGrid() {
    const data = useData();
    const { selectedId, selectedIds } = useSelection();
    const [error, setError] = useState<string | null>(null);
    const launcher = useActionLauncher();

    const object = selectedId ? data.getObject(selectedId) : undefined;
    if (!object) return <p>Объект не выбран.</p>;

    const group = selectedIds.flatMap((id) => {
        const o = data.getObject(id);
        return o ? [o] : [];
    });
    const objects: DataObject[] = group.some((o) => o.id === object.id) ? group : [object];
    const ids = objects.map((o) => o.id);
    const type = data.getType(object.type);

    const items: GridItem[] = [
        ...commonProperties(object, objects, data.getType).map((entry): GridItem => ({
            kind: 'property',
            id: entry.property.id,
            order: entry.property.order,
            category: entry.property.category,
            entry,
        })),
        ...data.getGroupActions(ids, 'propertyGrid').map(({ action, unavailable }): GridItem => ({
            kind: 'action',
            id: action.id,
            order: action.order,
            category: action.category,
            action,
            unavailable,
        })),
    ];
    const sections = toSections(sortItems(items));
    const shownError = error ?? launcher.error;
    const groupKey = ids.join(',');

    async function commit(property: PropertyDefinition, value: unknown): Promise<boolean> {
        setError(null);
        const result =
            ids.length === 1
                ? await data.setProperty(object!.id, property.id, value)
                : await data.perform((tx) => {
                      // Объекты, где значение уже равно новому, пропускаем
                      for (const id of ids) {
                          const current = data.getObject(id)?.properties[property.id] ?? null;
                          if (current === (value ?? null)) continue;
                          tx.setProperty(id, property.id, value);
                      }
                  });
        if (!result.ok) setError(result.error);
        return result.ok;
    }

    function launch(action: ActionDefinition) {
        setError(null);
        if (ids.length === 1) void launcher.launch(object!.id, action);
        else void launcher.launchMany(ids, action);
    }

    function renderItems(sectionItems: readonly GridItem[]): ReactNode[] {
        const nodes: ReactNode[] = [];
        for (let i = 0; i < sectionItems.length; i++) {
            const item = sectionItems[i];
            if (item.kind === 'action') {
                // Подряд идущие действия — одной строкой
                const run: Extract<GridItem, { kind: 'action' }>[] = [item];
                while (i + 1 < sectionItems.length) {
                    const next = sectionItems[i + 1];
                    if (next.kind !== 'action') break;
                    run.push(next);
                    i++;
                }
                nodes.push(<ActionRow key={`action:${item.id}`} items={run} onLaunch={launch} />);
                continue;
            }
            const { property, value }: CommonProperty = item.entry;
            nodes.push(
                <Row
                    key={`${groupKey}:${property.id}`}
                    property={property}
                    value={value.mixed ? undefined : value.value}
                    mixed={value.mixed}
                    data={data}
                    onCommit={(next) => commit(property, next)}
                    onInvalid={setError}
                />,
            );
        }
        return nodes;
    }

    return (
        <div className="property-grid">
            <h2>{type?.name ?? object.type}</h2>
            {ids.length > 1 && <p>Выделено объектов: {ids.length}</p>}
            {shownError && <p role="alert">{shownError}</p>}
            {launcher.dialog}
            {sections.map((section, index) =>
                section.category === null ? (
                    <div key={`start:${index}`}>{renderItems(section.items)}</div>
                ) : (
                    <section
                        key={`${section.category}:${index}`}
                        role="group"
                        aria-label={section.category}
                    >
                        <h3>{section.category}</h3>
                        {renderItems(section.items)}
                    </section>
                ),
            )}
        </div>
    );
}
