import { useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { useData } from '../data/DataProvider';
import type { DataController } from '../data/DataController';
import type { ActionDefinition, PropertyDefinition } from '../types/types';

type Draft = Record<string, string | boolean>;

/** Результат разбора поля: значение (`undefined` — не передавать) либо причина отказа. */
type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

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

function initialDraft(parameters: PropertyDefinition[]): Draft {
    const draft: Draft = {};
    for (const p of parameters) {
        if (p.kind === 'boolean') draft[p.id] = p.default === true;
        else if (p.default !== undefined && p.default !== null) draft[p.id] = String(p.default);
    }
    return draft;
}

function titleOf(data: DataController, id: string): string {
    const object = data.getObject(id);
    if (!object) return id;
    const name = object.properties.name;
    return typeof name === 'string' && name ? name : (data.getType(object.type)?.name ?? id);
}

/** Объекты, которые можно выбрать в ссылочном параметре: по `targetTypes` (без него — любые). */
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
    const id = useId();
    const text = typeof value === 'string' ? value : '';
    const label = parameter.required ? `${parameter.name} *` : parameter.name;
    let control: ReactNode;
    switch (parameter.kind) {
        case 'boolean':
            control = (
                <input
                    id={id}
                    type="checkbox"
                    checked={value === true}
                    onChange={(e) => onChange(e.target.checked)}
                />
            );
            break;
        case 'text':
            control = (
                <textarea
                    id={id}
                    rows={3}
                    value={text}
                    aria-required={parameter.required}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
            break;
        case 'enum':
            control = (
                <select
                    id={id}
                    value={text}
                    aria-required={parameter.required}
                    onChange={(e) => onChange(e.target.value)}
                >
                    <option value=""></option>
                    {(parameter.values ?? []).map((v) => (
                        <option key={v.value} value={v.value}>
                            {v.name}
                        </option>
                    ))}
                </select>
            );
            break;
        case 'reference':
            control = (
                <select
                    id={id}
                    value={text}
                    aria-required={parameter.required}
                    onChange={(e) => onChange(e.target.value)}
                >
                    <option value=""></option>
                    {referenceOptions(data, parameter).map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.title}
                        </option>
                    ))}
                </select>
            );
            break;
        default:
            control = (
                <input
                    id={id}
                    type={
                        parameter.kind === 'date'
                            ? 'date'
                            : parameter.kind === 'time'
                              ? 'time'
                              : 'text'
                    }
                    inputMode={parameter.kind === 'integer' ? 'numeric' : undefined}
                    value={text}
                    aria-required={parameter.required}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
    }
    return (
        <div className="action-dialog-field">
            <label htmlFor={id}>{label}</label>
            {control}
        </div>
    );
}

export interface ActionDialogProps {
    action: ActionDefinition;
    /** Запуск действия с собранными параметрами; возвращает причину отказа или `null` при успехе. */
    onSubmit(params: Record<string, unknown>): Promise<string | null>;
    onCancel(): void;
}

/** Диалог ввода параметров действия: поля строятся по описанию параметров, обязательные проверяются. */
export function ActionDialog({ action, onSubmit, onCancel }: ActionDialogProps) {
    const data = useData();
    const parameters = action.parameters ?? [];
    const [draft, setDraft] = useState<Draft>(() => initialDraft(parameters));
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

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
        <div role="dialog" aria-modal="true" aria-label={action.name} className="action-dialog">
            <form onSubmit={(e) => void submit(e)} noValidate>
                <h2>{action.name}</h2>
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
                <button type="submit" disabled={busy}>
                    Выполнить
                </button>
                <button type="button" onClick={onCancel}>
                    Отмена
                </button>
            </form>
        </div>
    );
}
