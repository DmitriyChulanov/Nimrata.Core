import { describe, expect, it } from 'vitest';

import { safeUrl } from './safeUrl';

/**
 * Безопасный адрес для перехода по внешней ссылке
 */
describe('safeUrl', () => {
    /**
     * Проверяет, что http и https принимаются, а пробелы по краям отбрасываются
     */
    it('safeUrl_httpAndHttps_areAcceptedAndTrimmed', () => {
        expect(safeUrl('  https://example.test/a ')).toBe('https://example.test/a');
        expect(safeUrl('http://example.test/')).toBe('http://example.test/');
    });

    /**
     * Проверяет, что другие схемы, не-строки и мусор отклоняются
     */
    it('safeUrl_otherSchemesNonStringsAndGarbage_returnNull', () => {
        expect(safeUrl('javascript:alert(1)')).toBeNull();
        expect(safeUrl('data:text/html,x')).toBeNull();
        expect(safeUrl('не адрес')).toBeNull();
        expect(safeUrl(42)).toBeNull();
        expect(safeUrl(undefined)).toBeNull();
    });
});
