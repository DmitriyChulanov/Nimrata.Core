import { describe, expect, it } from 'vitest';

import { uuid7 } from './uuid7';

/**
 * Генератор идентификаторов UUIDv7
 */
describe('uuid7', () => {
    /**
     * Проверяет, что формат — версия 7 с вариантом RFC 4122
     */
    it('uuid7_format_isVersion7WithRfc4122Variant', () => {
        expect(uuid7()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });

    /**
     * Проверяет, что первые 48 бит — время в миллисекундах
     */
    it('uuid7_first48Bits_areTimeInMilliseconds', () => {
        expect(uuid7(0x018f00000000).startsWith('018f0000-0000-7')).toBe(true);
    });

    /**
     * Проверяет, что идентификаторы различаются, а более поздние сортируются позже
     */
    it('uuid7_ids_differAndLaterOnesSortLater', () => {
        const a = uuid7(1_700_000_000_000);
        const b = uuid7(1_700_000_000_001);
        expect(a).not.toBe(uuid7(1_700_000_000_000));
        expect(a < b).toBe(true);
    });
});
