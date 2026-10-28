import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Icon } from '@platform/icons/Icon';

import { classNames } from './classNames';
import './ContextMenu.css';

import type { KeyboardEvent } from 'react';
import type { MenuEntry } from './Menu';

/**
 * Горизонтальный разделитель между группами пунктов
 */
export interface ContextMenuSeparator {
    /** Идентификатор разделителя, уникальный в меню */
    id: string;
    separator: true;
}

/**
 * Свойства контекстного меню
 */
export interface ContextMenuProps {
    /** Название меню для вспомогательных технологий */
    label: string;
    /** Координаты вызова в окне (место указателя) */
    x: number;
    y: number;
    /** Пункты и разделители по порядку */
    items: (MenuEntry | ContextMenuSeparator)[];
    /** Вызывается при закрытии: выбор пункта, `Escape`, клик снаружи */
    onClose(): void;
}

/**
 * Контекстное меню у указателя: пункты с иконками и разделителями, стрелки, `Escape` и клик снаружи
 * закрывают его; выбранный пункт выполняется, затем меню закрывается
 *
 * @param props - название, место показа, пункты и обработчик закрытия
 * @returns плавающий список пунктов
 */
export function ContextMenu({ label, x, y, items, onClose }: ContextMenuProps) {
    const list = useRef<HTMLUListElement>(null);
    const [position, setPosition] = useState({ left: x, top: y });

    // Меню не выходит за края окна
    useLayoutEffect(() => {
        const element = list.current;
        if (!element) return;
        const { width, height } = element.getBoundingClientRect();
        setPosition({
            left: Math.max(0, Math.min(x, window.innerWidth - width)),
            top: Math.max(0, Math.min(y, window.innerHeight - height)),
        });
    }, [x, y, items.length]);

    const enabled = () =>
        Array.from(
            list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
                [],
        );

    useEffect(() => {
        enabled()[0]?.focus();
    }, []);

    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('click', onClose);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('click', onClose);
            document.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    function handleKeyDown(event: KeyboardEvent) {
        const buttons = enabled();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const move = (target: number) => {
            event.preventDefault();
            buttons[(target + buttons.length) % buttons.length]?.focus();
        };
        if (event.key === 'ArrowDown') move(index + 1);
        else if (event.key === 'ArrowUp') move(index - 1);
        else if (event.key === 'Home') move(0);
        else if (event.key === 'End') move(buttons.length - 1);
        else if (event.key === 'Tab') onClose();
    }

    return (
        <ul
            ref={list}
            role="menu"
            aria-label={label}
            className="context-menu"
            style={position}
            onKeyDown={handleKeyDown}
        >
            {items.map((item) =>
                'separator' in item ? (
                    <li key={item.id} role="separator" className="context-menu__separator" />
                ) : (
                    <li key={item.id} role="none">
                        <button
                            type="button"
                            role="menuitem"
                            disabled={item.disabled}
                            aria-keyshortcuts={item.shortcut}
                            className={classNames(
                                'context-menu__item',
                                item.danger && 'context-menu__item--danger',
                            )}
                            onClick={() => item.onSelect()}
                        >
                            {item.icon !== undefined && <Icon name={item.icon} />}
                            <span className="context-menu__label">{item.label}</span>
                            {item.shortcut && (
                                <span aria-hidden="true" className="context-menu__shortcut">
                                    {item.shortcut}
                                </span>
                            )}
                        </button>
                    </li>
                ),
            )}
        </ul>
    );
}
