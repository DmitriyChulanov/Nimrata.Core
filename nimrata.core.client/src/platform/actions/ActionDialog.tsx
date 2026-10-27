import { useId, useState } from 'react';

import { useData } from '@platform/data/useData';
import './ActionDialog.css';
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from '@platform/ui';

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
 * Начальный черновик формы по значениям параметров по умолчанию
 *
 * @param parameters - параметры действия
 * @returns черновик с заполненными значениями по умолчанию
 */
function initialDraft(parameters: PropertyDefinition[]): Draft {
    const draft: Draft = {};
    for (const p of parameters) {
        if (p.kind === 'boolean') draft[p.id] = p.default === true;
        else if (p.default !== undefined && p.default !== null) draft[p.id] = String(p.default);
    }
    return draft;
}

/**
 * Название объекта для списка выбора: вычисляемое имя, иначе название типа
 *
 * @param data - контроллер данных
 * @param id - идентификатор объекта
 * @returns текст для показа; идентификатор, если объекта нет
 */
function titleOf(data: DataController, id: string): string {
    const object = data.getObject(id);
    if (!object) return id;
    const name = object.properties.name;
    return typeof name === 'string' && name ? name : (data.getType(object.type)?.name ?? id);
}

/**
 * Объекты, которые можно выбрать в ссылочном параметре: по `targetTypes` (без него — любые)
 */
function referenceOptions(data: DataController, parameter: PropertyDefinition) {
    const targets = parameter.targetTypes;
    const result: { id: string; title: string }[] = [];
    const walk = (parent: string | null) => {
        for (const o of data.getChildren(parent)) {
            if (!targets || targets.includes(o.type)) {
                result.push({ id: o.id, title: titleOf(data, o.id) });
            }
            walk(o.id);
        }
    };
    walk(null);
    return result;
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
    data,
}: {
    parameter: PropertyDefinition;
    value: string | boolean | undefined;
    onChange: (value: string | boolean) => void;
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
                <Select
                    {...common}
                    value={text}
                    placeholder=""
                    options={referenceOptions(data, parameter).map((o) => ({
                        value: o.id,
                        label: o.title,
                    }))}
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
    const [draft, setDraft] = useState<Draft>(() => initialDraft(parameters));
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const formId = useId();

    async function submit(event: FormEvent) {
        event.preventDefault();
        const params: Record<string, unknown> = {};
        for (const p of parameters) {
            const parsed = parseField(p, draft[p.id]);
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
        if (failure !== null) setError(failure);
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
                onSubmit={(e) => void submit(e)}
                noValidate
                className="action-dialog-form"
            >
                {parameters.map((p) => (
                    <Field
                        key={p.id}
                        parameter={p}
                        value={draft[p.id]}
                        onChange={(value) => setDraft((prev) => ({ ...prev, [p.id]: value }))}
                        data={data}
                    />
                ))}
                {error && <p role="alert">{error}</p>}
            </form>
        </Dialog>
    );
}
