import type { DataObject } from '@platform/data/DataController';
import type { ActionDefinition, PropertyDefinition, TypeDefinition } from '@platform/types/types';

/**
 * Название категории для строк без категории, следующих за строками с категорией
 */
export const OTHER_CATEGORY = 'Прочее';

/**
 * Значение свойства группы: общее значение либо признак «Различны»
 */
export type GroupValue = { mixed: false; value: unknown } | { mixed: true };

/**
 * Свойство, общее для всех объектов выделения
 */
export interface CommonProperty {
    /** Описание свойства (по основному объекту; `readOnly` — если только для чтения у любого объекта) */
    property: PropertyDefinition;
    /** Значение: общее или «Различны» */
    value: GroupValue;
}

/**
 * Строка таблицы: свойство или действие
 */
export type GridItem =
    | { kind: 'property'; id: string; order?: number; category?: string; entry: CommonProperty }
    | {
          kind: 'action';
          id: string;
          order?: number;
          category?: string;
          action: ActionDefinition;
          unavailable: string | null;
      };

/**
 * Раздел таблицы: заголовок категории (или `null`, если его нет) и строки
 */
export interface GridSection {
    /** Название категории; `null` — строки в начале списка без категории */
    category: string | null;
    /** Строки раздела в порядке показа */
    items: GridItem[];
}

/**
 * Совпадают ли списки значений двух описаний (перечисление или допустимые типы ссылки)
 */
function sameList(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Одно ли это свойство в двух типах: совпадают вид, варианты перечисления и допустимые типы цели
 */
function sameProperty(a: PropertyDefinition, b: PropertyDefinition): boolean {
    return (
        a.kind === b.kind &&
        sameList(a.values, b.values) &&
        sameList(a.targetTypes, b.targetTypes) &&
        !b.hidden
    );
}

/**
 * Свойства, общие для всех объектов выделения, со значениями
 *
 * @param primary - основной объект: у него берутся название, категория и порядок свойств
 * @param objects - все выделенные объекты, включая основной
 * @param getType - поиск типа по идентификатору
 * @returns видимые свойства основного типа, которые есть у каждого объекта с тем же видом
 */
export function commonProperties(
    primary: DataObject,
    objects: readonly DataObject[],
    getType: (id: string) => TypeDefinition | undefined,
): CommonProperty[] {
    const result: CommonProperty[] = [];
    for (const property of getType(primary.type)?.properties ?? []) {
        if (property.hidden) continue;
        let readOnly = property.readOnly === true;
        let common = true;
        for (const object of objects) {
            const other = getType(object.type)?.properties?.find((p) => p.id === property.id);
            if (!other || !sameProperty(property, other)) {
                common = false;
                break;
            }
            readOnly ||= other.readOnly === true;
        }
        if (!common) continue;

        const values = objects.map((o) => o.properties[property.id] ?? null);
        const same = values.every((v) => v === values[0]);
        result.push({
            property:
                readOnly === (property.readOnly === true) ? property : { ...property, readOnly },
            value: same
                ? { mixed: false, value: primary.properties[property.id] }
                : { mixed: true },
        });
    }
    return result;
}

/**
 * Сквозной порядок: сначала строки с `order` по возрастанию (при равенстве — в порядке описания),
 * затем остальные в порядке описания
 *
 * @param items - строки в порядке описания: сначала свойства, затем действия
 * @returns новый массив строк в порядке показа
 */
export function sortItems(items: readonly GridItem[]): GridItem[] {
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const orderA = a.item.order;
            const orderB = b.item.order;
            if (orderA !== undefined && orderB !== undefined)
                return orderA - orderB || a.index - b.index;
            if (orderA !== undefined) return -1;
            if (orderB !== undefined) return 1;
            return a.index - b.index;
        })
        .map(({ item }) => item);
}

/**
 * Делит упорядоченные строки на разделы: заголовок вставляется при каждой смене категории.
 * Строки без категории в начале списка идут без заголовка, после категорий — под «Прочее»
 *
 * @param items - строки в порядке показа
 * @returns разделы таблицы
 */
export function toSections(items: readonly GridItem[]): GridSection[] {
    const sections: GridSection[] = [];
    let categorized = false;
    for (const item of items) {
        const category = item.category || (categorized ? OTHER_CATEGORY : null);
        if (item.category) categorized = true;
        const last = sections.at(-1);
        if (last && last.category === category) last.items.push(item);
        else sections.push({ category, items: [item] });
    }
    return sections;
}
