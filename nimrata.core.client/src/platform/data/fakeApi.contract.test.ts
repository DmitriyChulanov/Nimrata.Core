import { describe, expect, it } from 'vitest';

import { ApiError } from '@platform/api/apiClient';

import { createFakeApi } from './fakeApi';

/**
 * Сценарий контракта Набора изменений (формат — `contracts/changeset/README.md`)
 */
interface Scenario {
    name: string;
    /** Подключено ли расширение `demo`; по умолчанию да */
    extensionEnabled?: boolean;
    objects: Record<string, unknown>[];
    operations: Record<string, unknown>[];
    expect: { ok: boolean; code?: string; conflict?: boolean };
}

interface TypesFile {
    extension: string;
    types: Record<string, unknown>[];
}

const files = import.meta.glob<{ default: unknown }>('../../../../contracts/changeset/*.json', {
    eager: true,
});

const typesFile = Object.entries(files).find(([path]) => path.endsWith('/types.json'))?.[1]
    .default as TypesFile;
const groups = Object.entries(files)
    .filter(([path]) => !path.endsWith('/types.json'))
    .map(([path, module]) => ({
        file: path.slice(path.lastIndexOf('/') + 1),
        scenarios: (module.default as { scenarios: Scenario[] }).scenarios,
    }));

/**
 * Один набор сценариев, общий с серверными тестами: клиентский тест не должен проходить там,
 * где сервер откажет (результат — признак успеха и код ошибки, не текст)
 */
describe('fakeApi: контракт Набора изменений совпадает с сервером', () => {
    it('contract_scenariosAreLoaded', () => {
        expect(typesFile.types.length).toBeGreaterThan(0);
        expect(groups.length).toBeGreaterThanOrEqual(5);
    });

    for (const { file, scenarios } of groups) {
        describe(file, () => {
            for (const scenario of scenarios) {
                it(scenario.name, async () => {
                    const types = typesFile.types.map((t) => ({
                        ...t,
                        extension: typesFile.extension,
                    }));
                    const api = createFakeApi(types, structuredClone(scenario.objects), {
                        extensions: [
                            {
                                id: typesFile.extension,
                                connected: scenario.extensionEnabled !== false,
                            },
                        ],
                    });

                    let actual: { ok: boolean; code?: string; conflict?: boolean };
                    try {
                        await api.post('changesets', {
                            operations: structuredClone(scenario.operations),
                        });
                        actual = { ok: true };
                    } catch (error) {
                        if (!(error instanceof ApiError)) throw error;
                        actual = { ok: false };
                        if (error.code) actual.code = error.code;
                        if (error.status === 409) actual.conflict = true;
                    }

                    expect(actual).toEqual(scenario.expect);
                });
            }
        });
    }
});
