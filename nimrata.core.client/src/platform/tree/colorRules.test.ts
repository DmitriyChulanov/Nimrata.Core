import { describe, expect, it } from 'vitest';

import { resolveRuleColor } from './colorRules';

import type { ColorRule } from '@platform/types/types';

const rules: ColorRule[] = [
    { property: 'priority', equals: 'medium', color: 'orange' },
    { property: 'priority', equals: 'high', color: 'red' },
    { property: 'status', equals: 'completed', color: 'green' },
];

/**
 * Определение цвета по правилам
 */
describe('resolveRuleColor', () => {
    /**
     * Проверяет, что правило с выполненным условием возвращает свой цвет
     */
    it('colorRules_ruleWithSatisfiedCondition_returnsItsColor', () => {
        expect(resolveRuleColor(rules, { priority: 'high' })).toBe('red');
    });

    /**
     * Проверяет, что без подходящего правила и без правил цвета нет
     */
    it('colorRules_noMatchingRuleAndNoRules_noColor', () => {
        expect(resolveRuleColor(rules, { priority: 'low' })).toBeUndefined();
        expect(resolveRuleColor(undefined, { priority: 'high' })).toBeUndefined();
    });

    /**
     * Проверяет, что при нескольких подходящих правилах выигрывает первое по порядку
     */
    it('colorRules_severalMatchingRules_firstByOrderWins', () => {
        const ordered: ColorRule[] = [
            { property: 'status', equals: 'completed', color: 'green' },
            { property: 'priority', equals: 'high', color: 'red' },
        ];
        const values = { priority: 'high', status: 'completed' };
        expect(resolveRuleColor(ordered, values)).toBe('green');
        expect(resolveRuleColor([...ordered].reverse(), values)).toBe('red');
    });

    /**
     * Проверяет, что значения сравниваются строго: число не равно строке, а отсутствующее свойство не совпадает
     */
    it('colorRules_valuesComparedStrictly_numberNotEqualToStringMissingPropertyDoesNotMatch', () => {
        const r: ColorRule[] = [{ property: 'n', equals: 1, color: 'blue' }];
        expect(resolveRuleColor(r, { n: 1 })).toBe('blue');
        expect(resolveRuleColor(r, { n: '1' })).toBeUndefined();
        expect(resolveRuleColor(r, {})).toBeUndefined();
    });
});
