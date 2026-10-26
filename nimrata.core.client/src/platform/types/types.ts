/**
 * Восемь видов свойств платформы
 */
export type PropertyKind =
    'string' | 'text' | 'integer' | 'boolean' | 'date' | 'time' | 'enum' | 'reference';

/**
 * Где доступно действие: в автоматизации, в таблице свойств или в контекстном меню
 */
export type ActionPlacement = 'automation' | 'propertyGrid' | 'contextMenu';

/**
 * Значение перечисления
 */
export interface EnumValue {
    /** Хранимое значение */
    value: string;
    /** Название для показа */
    name: string;
}

/**
 * Описание свойства типа или параметра действия
 */
export interface PropertyDefinition {
    /** Идентификатор свойства */
    id: string;
    /** Название свойства */
    name: string;
    /** Вид свойства */
    kind: PropertyKind;
    /** Категория для группировки в таблице свойств */
    category?: string;
    /** Свойство нельзя править вручную */
    readOnly?: boolean;
    /** Служебное свойство: в таблице свойств не показывается */
    hidden?: boolean;
    /** Обязательный параметр действия: диалог не отправит пустое значение */
    required?: boolean;
    /** Значение по умолчанию */
    default?: unknown;
    /** Значения перечисления (для `kind: 'enum'`) */
    values?: EnumValue[];
    /** Допустимые типы целевого объекта (для `kind: 'reference'`) */
    targetTypes?: string[];
    /**
     * Для `kind: 'reference'`: ссылка ведёт к цели механизма — во вкладке «Автоматизация» название
     * механизма выделяет цель в основном дереве
     */
    revealTarget?: boolean;
}

/**
 * Описание действия типа
 */
export interface ActionDefinition {
    /** Идентификатор действия */
    id: string;
    /** Название действия для показа */
    name: string;
    /** Без `placements` действие внутреннее и доступно только из кода */
    placements?: ActionPlacement[];
    /** Параметры, которые запрашивает диалог запуска */
    parameters?: PropertyDefinition[];
}

/**
 * Правило раскраски узла дерева по значению свойства
 */
export interface ColorRule {
    /** Идентификатор проверяемого свойства */
    property: string;
    /** Значение, при котором правило действует */
    equals: unknown;
    /** Цвет узла */
    color: string;
}

/**
 * Определение типа в виде, в котором его отдаёт `GET /api/types`
 */
export interface TypeDefinition {
    /** Идентификатор типа */
    id: string;
    /** Название типа */
    name: string;
    /** Идентификатор модуля, объявившего тип */
    module: string;
    /** Версия манифеста модуля, в которой описан тип */
    moduleVersion: number;
    /** Тип абстрактный: объекты такого типа создавать нельзя */
    abstract?: boolean;
    /** От типа нельзя наследовать */
    sealed?: boolean;
    /** Объекты типа не показываются в дереве */
    hiddenInTree?: boolean;
    /** Иконка узла в дереве (имя из реестра иконок); без неё или при неизвестном имени показывается значок по умолчанию */
    icon?: string;
    /** Цвет иконки узла: имя палитры (red, orange, yellow, green, blue, purple, gray); без него иконка наследует цвет текста */
    iconColor?: string;
    automation?: boolean;
    allowedChildren?: string[];
    properties?: PropertyDefinition[];
    actions?: ActionDefinition[];
    colorRules?: ColorRule[];
}
