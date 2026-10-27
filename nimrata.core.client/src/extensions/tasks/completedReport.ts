import { downloadBlob } from '@platform';

import { COMPLETED_REPORT_COMMAND, COMPLETED_TASKS_ROOT, DAY_TYPES, TASK } from './constants';
import { parseIso } from './dates';
import { findRoot } from './nodes';

import type { DataController, DataObject } from '@platform';

/**
 * Сохранение файла: подменяется в тестах
 */
export type SaveFile = (blob: Blob, fileName: string) => void;

/**
 * Строка отчёта: день и названия его завершённых задач
 */
export interface ReportRow {
    /** Дата дня `ГГГГ-ММ-ДД` */
    date: string;
    /** Названия задач дня по возрастанию */
    tasks: string[];
}

/**
 * Название листа отчёта
 */
export const REPORT_SHEET = 'Отчет';

/**
 * Ширина колонки «Дата», в символах
 */
export const DATE_COLUMN_WIDTH = 15;

/**
 * Ширина колонки «Задачи», в символах
 */
export const TASKS_COLUMN_WIDTH = 100;

/**
 * Дата `ГГГГ-ММ-ДД` в виде `ДД.ММ.ГГГГ`
 */
export function formatDate(iso: string): string {
    const [year, month, day] = iso.split('-');
    return `${day}.${month}.${year}`;
}

/**
 * Заголовок отчёта за период
 */
export function reportTitle(start: string, end: string): string {
    return `Завершенные задачи за период ${formatDate(start)} – ${formatDate(end)}`;
}

/**
 * Название задачи для отчёта: вычисленное имя, иначе заголовок
 */
function taskLabel(task: DataObject): string {
    const name = task.properties.name;
    if (typeof name === 'string' && name !== '') return name;
    const title = task.properties.title;
    return typeof title === 'string' ? title : '';
}

/**
 * Сравнивает названия по-русски без учёта регистра
 */
const byName = (a: string, b: string) => a.localeCompare(b, 'ru', { sensitivity: 'base' });

/**
 * Собирает завершённые задачи из дней `CompletedTasksRoot` в периоде (границы включительно)
 * и группирует их по дням
 *
 * @param data - контроллер данных
 * @param start - начало периода `ГГГГ-ММ-ДД`
 * @param end - конец периода `ГГГГ-ММ-ДД`
 * @returns строки по возрастанию даты; дни без задач пропускаются
 */
export function collectCompleted(data: DataController, start: string, end: string): ReportRow[] {
    const root = findRoot(data, COMPLETED_TASKS_ROOT);
    const byDate = new Map<string, string[]>();

    const tasksIn = (parent: string): string[] =>
        data
            .getChildren(parent)
            .flatMap((child) => (child.type === TASK ? [taskLabel(child)] : tasksIn(child.id)));
    const walk = (parent: string) => {
        for (const child of data.getChildren(parent)) {
            if (!DAY_TYPES.includes(child.type)) {
                walk(child.id);
                continue;
            }
            const date = child.properties.date;
            if (typeof date !== 'string' || date < start || date > end) continue;
            const tasks = tasksIn(child.id);
            if (tasks.length > 0) byDate.set(date, [...(byDate.get(date) ?? []), ...tasks]);
        }
    };
    if (root) walk(root.id);

    return [...byDate.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, tasks]) => ({ date, tasks: tasks.sort(byName) }));
}

/**
 * Читает и проверяет дату-параметр
 */
function readDate(params: Record<string, unknown>, key: 'start' | 'end', label: string): string {
    const value = params[key];
    if (typeof value !== 'string' || !parseIso(value)) {
        throw new Error(`Параметр «${label}» должен быть датой.`);
    }
    return value;
}

/**
 * Данные листа отчёта: заголовок, шапка и строки «дата — задачи через перенос строки»
 */
export function reportSheetData(start: string, end: string, rows: ReportRow[]) {
    return [
        [{ value: reportTitle(start, end), fontWeight: 'bold' as const }],
        [
            { value: 'Дата', fontWeight: 'bold' as const },
            { value: 'Задачи', fontWeight: 'bold' as const },
        ],
        ...rows.map((row) => [
            { value: formatDate(row.date), alignVertical: 'top' as const },
            { value: row.tasks.join('\n'), wrap: true, alignVertical: 'top' as const },
        ]),
    ];
}

/**
 * Формирует книгу `.xlsx` с отчётом; библиотека подгружается при первом запуске команды
 */
export async function buildReportFile(
    start: string,
    end: string,
    rows: ReportRow[],
): Promise<Blob> {
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    return writeXlsxFile(reportSheetData(start, end, rows), {
        sheet: REPORT_SHEET,
        columns: [{ width: DATE_COLUMN_WIDTH }, { width: TASKS_COLUMN_WIDTH }],
    }).toBlob();
}

/**
 * Подключает команду «Отчёт по завершённым задачам»: формирует `.xlsx` со сводкой за период
 * и скачивает его
 *
 * @param data - контроллер данных
 * @param save - сохранение файла (по умолчанию — скачивание браузером)
 * @returns функция отписки
 */
export function registerCompletedReport(
    data: DataController,
    save: SaveFile = downloadBlob,
): () => void {
    return data.registerCommand(COMPLETED_REPORT_COMMAND, async ({ params }) => {
        const start = readDate(params, 'start', 'Начало');
        const end = readDate(params, 'end', 'Конец');
        if (start > end) throw new Error('Начало периода не может быть позже конца.');
        const rows = collectCompleted(data, start, end);
        if (rows.length === 0) throw new Error('За выбранный период нет завершённых задач.');
        const file = await buildReportFile(start, end, rows);
        save(file, `Завершенные задачи ${formatDate(start)} – ${formatDate(end)}.xlsx`);
    });
}
