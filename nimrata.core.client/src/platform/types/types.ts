/** Восемь видов свойств платформы. */
export type PropertyKind =
    'string' | 'text' | 'integer' | 'boolean' | 'date' | 'time' | 'enum' | 'reference';

export type ActionPlacement = 'automation' | 'propertyGrid' | 'contextMenu';

export interface EnumValue {
    value: string;
    name: string;
}

export interface PropertyDefinition {
    id: string;
    name: string;
    kind: PropertyKind;
    category?: string;
    readOnly?: boolean;
    default?: unknown;
    /** Значения перечисления (для `kind: 'enum'`). */
    values?: EnumValue[];
    /** Допустимые типы целевого объекта (для `kind: 'reference'`). */
    targetTypes?: string[];
}

export interface ActionDefinition {
    id: string;
    name: string;
    /** Без `placements` действие внутреннее и доступно только из кода. */
    placements?: ActionPlacement[];
    parameters?: PropertyDefinition[];
}

export interface ColorRule {
    property: string;
    equals: unknown;
    color: string;
}

/** Определение типа в виде, в котором его отдаёт `GET /api/types`. */
export interface TypeDefinition {
    id: string;
    name: string;
    /** Идентификатор модуля, объявившего тип. */
    module: string;
    moduleVersion: number;
    abstract?: boolean;
    sealed?: boolean;
    hiddenInTree?: boolean;
    /** Иконка узла в дереве (символ или эмодзи); без неё показывается значок по умолчанию. */
    icon?: string;
    automation?: boolean;
    allowedChildren?: string[];
    properties?: PropertyDefinition[];
    actions?: ActionDefinition[];
    colorRules?: ColorRule[];
}
