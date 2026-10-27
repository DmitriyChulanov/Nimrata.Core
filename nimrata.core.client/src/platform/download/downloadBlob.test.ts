import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob } from './downloadBlob';

/**
 * Скачивание файла из браузера
 */
describe('Platform: downloadBlob', () => {
    afterEach(() => vi.restoreAllMocks());

    /**
     * Проверяет, что файл отдаётся через временную ссылку с заданным именем, а ссылка освобождается
     */
    it('downloadBlob_blob_clicksTemporaryLinkWithNameAndRevokesUrl', () => {
        const create = vi.fn(() => 'blob:test');
        const revoke = vi.fn();
        Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const blob = new Blob(['x']);

        downloadBlob(blob, 'Отчёт.xlsx');

        const clicked = click.mock.contexts[0];
        expect(create).toHaveBeenCalledWith(blob);
        expect(clicked?.download).toBe('Отчёт.xlsx');
        expect(clicked?.href).toBe('blob:test');
        expect(revoke).toHaveBeenCalledWith('blob:test');
        expect(document.querySelector('a[download]')).toBeNull();
    });
});
