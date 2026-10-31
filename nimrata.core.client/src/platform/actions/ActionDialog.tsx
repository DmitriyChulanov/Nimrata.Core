import { useId, useState } from 'react';

import { useData } from '@platform/data/useData';
import { ObjectTreePicker } from '@platform/tree/ObjectTreePicker';
import './ActionDialog.css';
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from '@platform/ui';

import {
    hasReferenceChoices,
    isReferenceAllowed,
    readLastChoice,
    referenceRoot,
    writeLastChoice,
} from './referenceParameter';

import type { FormEvent } from 'react';
import type { DataController } from '@platform/data/DataController';
import type { ActionDefinition, PropertyDefinition } from '@platform/types/types';

/**
 * Черновик формы: введённые значения полей по идентификаторам параметров
 */
type Draft = Record<string, string | boolean>;

/**
 * Результат разбора поля: значение (`undefined` — не передавать) либо причина отказа
 */
type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Разбирает введённое значение параметра по его виду
 *
 * @param parameter - описание параметра
 * @param raw - введённое значение: строка или признак флажка
 * @returns значение для передачи действию либо причина отказа
 */
function parseField(parameter: PropertyDefinition, raw: string | boolean | undefined): Parsed {
    if (parameter.kind === 'boolean') return { ok: true, value: raw === true };
    const text = typeof raw === 'string' ? raw : '';
    if (text.trim() === '') return { ok: true, value: undefined };
    switch (parameter.kind) {
        case 'integer': {
            const trimmed = text.trim();
            if (!/^-?\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
                return { ok: false, error: `${parameter.name}: введите целое число.` };
            }
            return { ok: true, value: Number(trimmed) };
        }
        case 'date':
            return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text))
                ? { ok: true, value: text }
                : { ok: false, error: `${parameter.name}: введите дату в формате ГГГГ-ММ-ДД.` };
        case 'time':
            return /^([01]\d|2[0-3]):[0-5]\d$/.test(text)
                ? { ok: true, value: text }
                : { ok: false, error: `${parameter.name}: введите время в формате ЧЧ:мм.` };
        default:
            return { ok: true, value: text };
    }
}

/**
 * Ключ запомненного выбора ссылочного параметра: одно действие на разных объектах делит выбор
 */
function choiceKey(actionId: string, parameter: PropertyDefinition): string {
    return `${actionId}:${parameter.id}`;
}

/**
 * Нужно ли запоминать выбор параметра: дерево с корнем выбора (`targetRootType`)
 */
function remembersChoice(parameter: PropertyDefinition): boolean {
    return parameter.kind === 'reference' && parameter.targetRootType !== undefined;
}

/**
 * Показывается ли параметр: ссылочный параметр с корнем выбора, где выбирать нечего, скрыт, если не
 * обязателен
 */
function isVisible(data: DataController, parameter: PropertyDefinition): boolean {
    if (!remembersChoice(parameter) || parameter.required) return true;
    const root = referenceRoot(data, parameter);
    return root !== undefined && hasReferenceChoices(data, parameter, root);
}

/**
 * Начальный черновик формы по значениям параметров по умолчанию и запомненному выбору
 *
 * @param parameters - параметры действия
 * @param data - контроллер данных
 * @param actionId - идентификатор действия
 * @returns черновик с заполненными значениями
 */
function initialDraft(
    parameters: PropertyDefinition[],
    data: DataController,
    actionId: string,
): Draft {
    const draft: Draft = {};
    for (const p of parameters) {
        if (p.kind === 'boolean') draft[p.id] = p.default === true;
        else if (p.default !== undefined && p.default !== null) draft[p.id] = String(p.default);
        if (remembersChoice(p)) {
            const remembered = readLastChoice(choiceKey(actionId, p));
            const object = remembered ? data.getObject(remembered) : undefined;
            const root = referenceRoot(data, p);
            if (object && root !== undefined && isReferenceAllowed(data, p, root, object)) {
                draft[p.id] = object.id;
            }
        }
    }
    return draft;
}

/**
 * Поле ссылочного параметра: подпись, кнопка сброса и дерево выбора
 *
 * @param props - параметр, подпись, значение, обработчики и контроллер данных
 * @returns группа с деревом объектов
 */
function ReferenceField({
    parameter,
    label,
    value,
    onChange,
    onConfirm,
    data,
}: {
    parameter: PropertyDefinition;
    label: string;
    value: string;
    onChange: (value: string) => void;
    onConfirm: (value: string) => void;
    data: DataController;
}) {
    const root = referenceRoot(data, parameter) ?? null;
    return (
        <div className="action-dialog-reference">
            <div className="action-dialog-reference__head">
                <span aria-hidden="true">{label}</span>
                {!parameter.required && (
                    <Button disabled={value === ''} onClick={() => onChange('')}>
                        {parameter.emptyLabel ?? 'Сбросить'}
                    </Button>
                )}
            </div>
            <ObjectTreePicker
                data={data}
                label={parameter.name}
                rootId={root}
                isAllowed={(o) => isReferenceAllowed(data, parameter, root, o)}
                selected={value === '' ? null : value}
                onSelect={onChange}
                onConfirm={onConfirm}
            />
        </div>
    );
}

/**
 * Поле формы для одного параметра действия; вид элемента зависит от вида параметра
 *
 * @param props - параметр, его значение, обработчик изменения и контроллер данных
 * @returns подписанное поле ввода
 */
function Field({
    parameter,
    value,
    onChange,
    onConfirm,
    data,
}: {
    parameter: PropertyDefinition;
    value: string | boolean | undefined;
    onChange: (value: string | boolean) => void;
    onConfirm: (value: string) => void;
    data: DataController;
}) {
    const text = typeof value === 'string' ? value : '';
    const label = parameter.required ? `${parameter.name} *` : parameter.name;
    const common = {
        label,
        'aria-required': parameter.required,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    };
    switch (parameter.kind) {
        case 'boolean':
            return (
                <Checkbox
                    label={label}
                    checked={value === true}
                    onChange={(e) => onChange(e.target.checked)}
                />
            );
        case 'text':
            return <TextArea {...common} rows={3} value={text} />;
        case 'enum':
            return (
                <Select
                    {...common}
                    value={text}
                    placeholder=""
                    options={(parameter.values ?? []).map((v) => ({
                        value: v.value,
                        label: v.name,
                    }))}
                />
            );
        case 'reference':
            return (
                <ReferenceField
                    parameter={parameter}
                    label={label}
                    value={text}
                    onChange={onChange}
                    onConfirm={onConfirm}
                    data={data}
                />
            );
        default:
            return (
                <TextField
                    {...common}
                    type={
                        parameter.kind === 'date'
                            ? 'date'
                            : parameter.kind === 'time'
                              ? 'time'
                              : 'text'
                    }
                    inputMode={parameter.kind === 'integer' ? 'numeric' : undefined}
                    value={text}
                />
            );
    }
}

/**
 * Свойства компонента `ActionDialog`
 */
export interface ActionDialogProps {
    /** Запускаемое действие и описание его параметров */
    action: Pick<ActionDefinition, 'id' | 'name' | 'parameters'>;
    /** Запуск действия с собранными параметрами; возвращает причину отказа или `null` при успехе */
    onSubmit(params: Record<string, unknown>): Promise<string | null>;
    /** Закрывает диалог без запуска действия */
    onCancel(): void;
}

/**
 * Диалог ввода параметров действия: поля строятся по описанию параметров, обязательные проверяются
 */
export function ActionDialog({ action, onSubmit, onCancel }: ActionDialogProps) {
    const data = useData();
    const parameters = action.parameters ?? [];
    const [draft, setDraft] = useState<Draft>(() => initialDraft(parameters, data, action.id));
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const formId = useId();

    const shown = parameters.filter((p) => isVisible(data, p));

    async function run(values: Draft) {
        const params: Record<string, unknown> = {};
        for (const p of shown) {
            const parsed = parseField(p, values[p.id]);
            if (!parsed.ok) {
                setError(parsed.error);
                return;
            }
            if (parsed.value === undefined) {
                if (p.required) {
                    setError(`Параметр «${p.name}» обязателен.`);
                    return;
                }
                continue;
            }
            params[p.id] = parsed.value;
        }
        setError(null);
        setBusy(true);
        const failure = await onSubmit(params);
        setBusy(false);
        if (failure !== null) {
            setError(failure);
            return;
        }
        for (const p of shown) {
            const chosen = params[p.id];
            if (remembersChoice(p) && typeof chosen === 'string') {
                writeLastChoice(choiceKey(action.id, p), chosen);
            }
        }
    }

    function submit(event: FormEvent) {
        event.preventDefault();
        void run(draft);
    }

    return (
        <Dialog
            title={action.name}
            onClose={onCancel}
            actions={
                <>
                    <Button onClick={onCancel}>Отмена</Button>
                    <Button type="submit" form={formId} variant="primary" disabled={busy}>
                        Выполнить
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                onSubmit={submit}
                noValidate
                className="action-dialog-form"
            >
                {shown.map((p) => (
                    <Field
                        key={p.id}
                        parameter={p}
                        value={draft[p.id]}
                        onChange={(value) => setDraft((prev) => ({ ...prev, [p.id]: value }))}
                        onConfirm={(value) => {
                            const next = { ...draft, [p.id]: value };
                            setDraft(next);
                            void run(next);
                        }}
                        data={data}
                    />
                ))}
                {error && <p role="alert">{error}</p>}
            </form>
        </Dialog>
    );
}
