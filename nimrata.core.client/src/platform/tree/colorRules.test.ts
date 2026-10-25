import { describe, expect, it } from 'vitest';

import type { ColorRule } from '../types/types';
import { resolveRuleColor } from './colorRules';

const rules: ColorRule[] = [
    { property: 'priority', equals: 'medium', color: 'orange' },
    { property: 'priority', equals: 'high', color: 'red' },
    { property: 'status', equals: 'completed', color: 'green' },
];

describe('resolveRuleColor', () => {
    it('возвращает цвет правила, условие которого выполнено', () => {
        expect(resolveRuleColor(rules, { priority: 'high' })).toBe('red');
    });

    it('без подходящего правила и без правил цвета нет', () => {
        expect(resolveRuleColor(rules, { priority: 'low' })).toBeUndefined();
        expect(resolveRuleColor(undefined, { priority: 'high' })).toBeUndefined();
    });

    it('при нескольких подходящих правилах побеждает первое по порядку', () => {
        const ordered: ColorRule[] = [
            { property: 'status', equals: 'completed', color: 'green' },
            { property: 'priority', equals: 'high', color: 'red' },
        ];
        const values = { priority: 'high', status: 'completed' };
        expect(resolveRuleColor(ordered, values)).toBe('green');
        expect(resolveRuleColor([...ordered].reverse(), values)).toBe('red');
    });

    it('сравнивает значения строго: число не равно строке, отсутствующее свойство не подходит', () => {
        const r: ColorRule[] = [{ property: 'n', equals: 1, color: 'blue' }];
        expect(resolveRuleColor(r, { n: 1 })).toBe('blue');
        expect(resolveRuleColor(r, { n: '1' })).toBeUndefined();
        expect(resolveRuleColor(r, {})).toBeUndefined();
    });
});
