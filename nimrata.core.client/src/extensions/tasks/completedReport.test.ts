import { describe, expect, it, vi } from 'vitest';

import { createDataController } from '@platform';
import { createFakeApi } from '@platform/data/fakeApi';

import {
    buildReportFile,
    collectCompleted,
    registerCompletedReport,
    reportSheetData,
    reportTitle,
} from './completedReport';
import manifest from './manifest.json';
import { ensureTasksStart, registerTasks } from './tasksExtension';

import type { CommandDefinition, DataController, DataObject, TypeDefinition } from '@platform';

const types = manifest.types.map((t) => ({
    ...t,
    extension: manifest.extension,
    extensionVersion: manifest.version,
})) as TypeDefinition[];

const command = manifest.commands.find((c) => c.id === 'completedReport') as CommandDefinition;

async function start() {
    const api = createFakeApi(types, []);
    const data = createDataController({ api });
    await data.load();
    registerTasks(data);
    await ensureTasksStart(data);
    const save = vi.fn();
    registerCompletedReport(data, save);
    return { api, data, save };
}

function currentRoot(data: DataController): DataObject {
    return data
        .getChildren(null)
        .flatMap((o) => data.getChildren(o.id))
        .find((o) => o.type === 'CurrentTasksRoot')!;
}

/**
 * Создаёт задачу на дату и сразу завершает её (она переезжает в день «Завершённых задач»)
 */
async function completed(data: DataController, title: string, date: string) {
    const created = await data.runAction(currentRoot(data).id, 'createTask', { title, date });
    if (!created.ok) throw new Error(created.error);
    const find = (parent: string | null): DataObject | undefined => {
        for (const o of data.getChildren(parent)) {
            if (o.type === 'Task' && o.properties.title === title) return o;
            const found = find(o.id);
            if (found) return found;
        }
        return undefined;
    };
    const done = await data.runAction(find(null)!.id, 'complete');
    if (!done.ok) throw new Error(done.error);
}

/**
 * Команда «Отчёт по завершённым задачам»
 */
describe('Tasks: completed report command', () => {
    /**
     * Проверяет описание команды в манифесте: имя, значок и обязательные параметры-даты
     */
    it('completedReport_manifest_hasCommandWithRequiredDateParameters', () => {
        expect(command.name).toBe('Отчёт по завершённым задачам');
        expect(command.parameters?.map((p) => [p.id, p.name, p.kind, p.required])).toEqual([
            ['start', 'Начало', 'date', true],
            ['end', 'Конец', 'date', true],
        ]);
    });

    /**
     * Проверяет группировку задач по дням и границы периода (включительно)
     */
    it('collectCompleted_tasksInPeriod_groupedByDayWithInclusiveBounds', async () => {
        const { data } = await start();
        await completed(data, 'Раньше', '2026-03-01');
        await completed(data, 'Первая', '2026-03-02');
        await completed(data, 'Вторая', '2026-03-02');
        await completed(data, 'Последняя', '2026-03-05');
        await completed(data, 'Позже', '2026-03-06');

        const rows = collectCompleted(data, '2026-03-02', '2026-03-05');

        expect(rows).toEqual([
            { date: '2026-03-02', tasks: ['Вторая', 'Первая'] },
            { date: '2026-03-05', tasks: ['Последняя'] },
        ]);
    });

    /**
     * Проверяет сортировку: даты по возрастанию независимо от порядка завершения, задачи по названию
     */
    it('collectCompleted_unorderedInput_sortsDatesAscendingAndTasksByName', async () => {
        const { data } = await start();
        await completed(data, 'Яблоко', '2026-04-10');
        await completed(data, 'арбуз', '2026-02-10');
        await completed(data, 'Банан', '2026-02-10');
        await completed(data, 'Ёж', '2026-02-10');

        const rows = collectCompleted(data, '2026-01-01', '2026-12-31');

        expect(rows.map((r) => r.date)).toEqual(['2026-02-10', '2026-04-10']);
        expect(rows[0].tasks).toEqual(['арбуз', 'Банан', 'Ёж']);
    });

    /**
     * Проверяет, что незавершённые задачи в отчёт не попадают
     */
    it('collectCompleted_currentTask_isIgnored', async () => {
        const { data } = await start();
        await data.runAction(currentRoot(data).id, 'createTask', {
            title: 'В работе',
            date: '2026-03-03',
        });

        expect(collectCompleted(data, '2026-01-01', '2026-12-31')).toEqual([]);
    });

    /**
     * Проверяет заголовок, шапку и строки листа: даты ДД.ММ.ГГГГ, задачи через перенос строки
     */
    it('reportSheetData_rows_hasTitleHeaderAndJoinedTasks', () => {
        const data = reportSheetData('2026-03-02', '2026-03-05', [
            { date: '2026-03-02', tasks: ['А', 'Б'] },
        ]);

        expect(reportTitle('2026-03-02', '2026-03-05')).toBe(
            'Завершенные задачи за период 02.03.2026 – 05.03.2026',
        );
        expect(data[0][0].value).toBe('Завершенные задачи за период 02.03.2026 – 05.03.2026');
        expect(data[1].map((c) => c.value)).toEqual(['Дата', 'Задачи']);
        expect(data[2].map((c) => c.value)).toEqual(['02.03.2026', 'А\nБ']);
    });

    /**
     * Проверяет, что формируется непустой файл .xlsx (zip-контейнер)
     */
    it('buildReportFile_rows_returnsZipBlob', async () => {
        const blob = await buildReportFile('2026-03-02', '2026-03-05', [
            { date: '2026-03-02', tasks: ['А'] },
        ]);
        const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 2);

        expect(blob.size).toBeGreaterThan(0);
        expect(Array.from(head)).toEqual([0x50, 0x4b]);
    });

    /**
     * Проверяет, что команда скачивает файл с именем по периоду
     */
    it('completedReport_period_savesXlsxFile', async () => {
        const { data, save } = await start();
        await completed(data, 'Сделано', '2026-03-03');

        const result = await data.runCommand(command, { start: '2026-03-01', end: '2026-03-31' });

        expect(result.ok).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0][1]).toBe('Завершенные задачи 01.03.2026 – 31.03.2026.xlsx');
        expect(save.mock.calls[0][0]).toBeInstanceOf(Blob);
    });

    /**
     * Проверяет, что пустой период даёт понятную ошибку, а файл не скачивается
     */
    it('completedReport_emptyPeriod_returnsMessageAndSavesNothing', async () => {
        const { data, save } = await start();
        await completed(data, 'Сделано', '2026-03-03');

        const result = await data.runCommand(command, { start: '2026-05-01', end: '2026-05-31' });

        expect(result).toEqual({
            ok: false,
            error: 'За выбранный период нет завершённых задач.',
        });
        expect(save).not.toHaveBeenCalled();
    });

    /**
     * Проверяет, что начало позже конца отклоняется
     */
    it('completedReport_startAfterEnd_returnsMessage', async () => {
        const { data, save } = await start();

        const result = await data.runCommand(command, { start: '2026-04-01', end: '2026-03-01' });

        expect(result).toEqual({ ok: false, error: 'Начало периода не может быть позже конца.' });
        expect(save).not.toHaveBeenCalled();
    });

    /**
     * Проверяет, что пропущенный обязательный параметр отклоняется платформой
     */
    it('completedReport_missingEnd_returnsRequiredMessage', async () => {
        const { data } = await start();

        const result = await data.runCommand(command, { start: '2026-04-01' });

        expect(result).toEqual({ ok: false, error: 'Параметр «Конец» обязателен.' });
    });
});
