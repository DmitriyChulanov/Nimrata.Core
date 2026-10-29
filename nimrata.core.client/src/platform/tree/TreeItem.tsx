import { memo } from 'react';

import { Icon } from '@platform/icons/Icon';

import { colorPresentation, resolveRuleColor } from './colorRules';
import { TypeIcon } from './TypeIcon';

import type {
    DragEvent as ReactDragEvent,
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent as ReactMouseEvent,
} from 'react';
import type { DataObject } from '@platform/data/DataController';
import type { TypeDefinition } from '@platform/types/types';
import type { DropPosition } from './planMove';

/**
 * Обработчики событий строки дерева; ссылка на объект обработчиков стабильна между отрисовками
 */
export interface TreeItemHandlers {
    /** Свернуть или развернуть узел */
    onToggle(id: string): void;
    /** Клик по строке (выделение, в том числе с Shift и Ctrl/Cmd) */
    onSelect(event: ReactMouseEvent, id: string): void;
    /** Контекстное меню строки */
    onContextMenu(event: ReactMouseEvent, id: string): void;
    /** Клавиши строки (Alt+стрелки — перенос) */
    onKeyDown(event: ReactKeyboardEvent, object: DataObject): void;
    /** Начало перетаскивания строки */
    onDragStart(event: ReactDragEvent, id: string): void;
    /** Перетаскивание над строкой */
    onDragOver(event: ReactDragEvent, id: string): void;
    /** Бросок на строку */
    onDrop(event: ReactDragEvent, id: string): void;
    /** Конец перетаскивания */
    onDragEnd(): void;
}

/**
 * Свойства строки дерева
 */
export interface TreeItemProps {
    /** Объект строки */
    object: DataObject;
    /** Тип объекта */
    type: TypeDefinition | undefined;
    /** Название для показа */
    title: string;
    /** Уровень вложенности; корень — 1 */
    level: number;
    /** Есть ли видимые потомки */
    hasChildren: boolean;
    /** Раскрыт ли узел */
    isOpen: boolean;
    /** Выделена ли строка */
    selected: boolean;
    /** Строка получает фокус клавишей Tab (одна на дерево) */
    focusable: boolean;
    /** Позиция строки среди видимых (с 1) */
    position: number;
    /** Число видимых строк */
    setSize: number;
    /** Смещение строки сверху в пикселях */
    top: number;
    /** Высота строки в пикселях */
    height: number;
    /** Строка — цель перетаскивания: куда ляжет узел или `invalid`, если сюда нельзя */
    drop: DropPosition | 'invalid' | undefined;
    /** Обработчики событий (стабильная ссылка) */
    handlers: TreeItemHandlers;
}

/**
 * Строка дерева; мемоизирована: перерисовывается, только когда меняются её объект, название,
 * положение или состояние (выделение, раскрытие, перетаскивание)
 *
 * @param props - свойства строки
 * @returns элемент `treeitem`
 */
export const TreeItem = memo(function TreeItem({
    object,
    type,
    title,
    level,
    hasChildren,
    isOpen,
    selected,
    focusable,
    position,
    setSize,
    top,
    height,
    drop,
    handlers,
}: TreeItemProps) {
    const { paletteColor, cssColor } = colorPresentation(
        resolveRuleColor(type?.colorRules, object.properties),
    );
    return (
        <div
            role="treeitem"
            aria-label={title}
            aria-level={level}
            aria-posinset={position}
            aria-setsize={setSize}
            aria-selected={selected}
            aria-expanded={hasChildren ? isOpen : undefined}
            data-rule-color={paletteColor}
            style={{
                color: cssColor,
                position: 'absolute',
                top,
                height,
                left: 0,
                right: 0,
                paddingLeft: `${(level - 1) * 16}px`,
            }}
            draggable
            tabIndex={focusable ? 0 : -1}
            onKeyDown={(e) => handlers.onKeyDown(e, object)}
            aria-disabled={drop === 'invalid' ? true : undefined}
            data-drop={drop === 'invalid' ? undefined : drop}
            onDragStart={(e) => handlers.onDragStart(e, object.id)}
            onDragOver={(e) => handlers.onDragOver(e, object.id)}
            onDrop={(e) => handlers.onDrop(e, object.id)}
            onDragEnd={() => handlers.onDragEnd()}
            onClick={(e) => handlers.onSelect(e, object.id)}
            onContextMenu={(e) => handlers.onContextMenu(e, object.id)}
        >
            {hasChildren ? (
                <button
                    type="button"
                    aria-label={isOpen ? 'Свернуть' : 'Развернуть'}
                    onClick={(e) => {
                        e.stopPropagation();
                        handlers.onToggle(object.id);
                    }}
                >
                    <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />
                </button>
            ) : (
                <span aria-hidden="true" />
            )}
            <TypeIcon type={type} />
            <span>{title}</span>
        </div>
    );
});
