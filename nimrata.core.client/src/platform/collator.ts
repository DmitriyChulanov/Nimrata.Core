/**
 * Сравнение названий по правилам русского языка
 */
export const collator = new Intl.Collator('ru');

/**
 * Сравнение названий по правилам русского языка без учёта регистра
 */
export const collatorBase = new Intl.Collator('ru', { sensitivity: 'base' });
