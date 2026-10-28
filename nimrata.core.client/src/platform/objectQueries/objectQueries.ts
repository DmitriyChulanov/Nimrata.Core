import type { DataObject } from '../data/DataController';
import type { TypeDefinition } from '../types/types';

/**
 * Узкий доступ к дереву Объектов и типам: хватает `DataController`, в тестах — литерал на `Map`
 */
export interface ObjectReader {
    /** Объект по идентификатору */
    getObject(id: string): DataObject | undefined;
    /** Тип по идентификатору */
    getType(id: string): TypeDefinition | undefined;
}

/**
 * Название объекта: свойство `name`, иначе название типа, иначе идентификатор типа
 *
 * @param reader - доступ к объектам и типам
 * @param object - объект
 * @returns текст для показа
 */
export function objectLabel(reader: ObjectReader, object: DataObject): string {
    const name = object.properties.name;
    if (typeof name === 'string' && name !== '') return name;
    return reader.getType(object.type)?.name ?? object.type;
}

/**
 * Предки объекта от ближайшего к корню; обход обрывается на отсутствующем родителе и на цикле
 *
 * @param reader - доступ к объектам и типам
 * @param object - объект, чьих предков нужно найти
 * @returns цепочка родителей, начиная с непосредственного
 */
export function ancestors(reader: ObjectReader, object: DataObject): DataObject[] {
    const chain: DataObject[] = [];
    const seen = new Set<string>([object.id]);
    for (let id = object.parent; id && !seen.has(id);) {
        const parent = reader.getObject(id);
        if (!parent) break;
        seen.add(id);
        chain.push(parent);
        id = parent.parent;
    }
    return chain;
}
