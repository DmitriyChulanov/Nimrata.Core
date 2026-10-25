import { describe, expect, it } from 'vitest';

import { uuid7 } from './uuid7';

describe('uuid7', () => {
    it('формат UUID версии 7 с вариантом RFC 4122', () => {
        expect(uuid7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('первые 48 бит — время в миллисекундах', () => {
        expect(uuid7(0x018f00000000).startsWith('018f0000-0000-7')).toBe(true);
    });

    it('идентификаторы различаются, а более поздние сортируются позже', () => {
        const a = uuid7(1_700_000_000_000);
        const b = uuid7(1_700_000_000_001);
        expect(a).not.toBe(uuid7(1_700_000_000_000));
        expect(a < b).toBe(true);
    });
});
