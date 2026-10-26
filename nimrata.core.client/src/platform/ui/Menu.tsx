import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '@platform/icons/Icon';

import { Button, IconButton } from './Button';
import { classNames } from './classNames';
import './Menu.css';

import type { KeyboardEvent, ReactNode } from 'react';

/**
 * Пункт выпадающего меню
 */
export interface MenuEntry {
    /** Идентификатор пункта, уникальный в меню */
    id: string;
    /** Подпись пункта */
    label: string;
    /** Имя иконки реестра слева от подписи */
    icon?: string;
    /** Подсказка о сочетании клавиш (только показ) */
    shortcut?: string;
    /** Пункт недоступен */
    disabled?: boolean;
    /** Пункт выполняет необратимое действие */
    danger?: boolean;
    /** Вызывается при выборе пункта; меню закрывается */
    onSelect(): void;
}

/**
 * Свойства выпадающего меню
 */
export interface MenuProps {
    /** Название меню для вспомогательных технологий; у кнопки без текста — её подпись */
    label: string;
    /** Пункты меню */
    items: MenuEntry[];
    /** Имя иконки кнопки-триггера; у кнопки без текста по умолчанию «menu» */
    icon?: string;
    /** Текст кнопки-триггера; без него кнопка показывает только иконку */
    children?: ReactNode;
    /** Класс корневого элемента */
    className?: string;
}

/**
 * Выпадающее меню действий: открывается кнопкой, управляется стрелками, закрывается по Esc,
 * Tab и клику снаружи; фокус возвращается на кнопку
 *
 * @param props - название, пункты и вид кнопки-триггера
 * @returns кнопка с меню
 */
export function Menu({ label, items, icon, children, className }: MenuProps) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const popupId = useId();

    const enabledItems = () =>
        Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
                [],
        );

    function close(restoreFocus: boolean) {
        setOpen(false);
        if (restoreFocus) root.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    }

    // Клик или касание вне меню закрывает его
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    // При открытии фокус уходит на первый доступный пункт
    useEffect(() => {
        if (open) enabledItems()[0]?.focus();
    }, [open]);

    function handleKeyDown(event: KeyboardEvent) {
        if (!open) return;
        const list = enabledItems();
        const index = list.indexOf(document.activeElement as HTMLButtonElement);
        switch (event.key) {
            case 'Escape':
                event.preventDefault();
                close(true);
                break;
            case 'Tab':
                close(false);
                break;
            case 'ArrowDown':
                event.preventDefault();
                list[(index + 1) % list.length]?.focus();
                break;
            case 'ArrowUp':
                event.preventDefault();
                list[(index - 1 + list.length) % list.length]?.focus();
                break;
            case 'Home':
                event.preventDefault();
                list[0]?.focus();
                break;
            case 'End':
                event.preventDefault();
                list[list.length - 1]?.focus();
                break;
        }
    }

    const triggerProps = {
        'aria-haspopup': 'menu' as const,
        'aria-expanded': open,
        'aria-controls': open ? popupId : undefined,
        onClick: () => setOpen((value) => !value),
    };

    return (
        <div ref={root} className={classNames('menu', className)} onKeyDown={handleKeyDown}>
            {children ? (
                <Button variant="ghost" icon={icon} {...triggerProps}>
                    {children}
                </Button>
            ) : (
                <IconButton icon={icon ?? 'menu'} label={label} {...triggerProps} />
            )}
            {open && (
                <ul id={popupId} role="menu" aria-label={label} className="menu-popup">
                    {items.map((item) => (
                        <li key={item.id} role="none">
                            <button
                                type="button"
                                role="menuitem"
                                disabled={item.disabled}
                                aria-keyshortcuts={item.shortcut}
                                className={classNames(
                                    'menu-item',
                                    item.danger && 'menu-item--danger',
                                )}
                                onClick={() => {
                                    close(true);
                                    item.onSelect();
                                }}
                            >
                                {item.icon !== undefined && <Icon name={item.icon} />}
                                <span className="menu-item__label">{item.label}</span>
                                {item.shortcut && (
                                    <span aria-hidden="true" className="menu-item__shortcut">
                                        {item.shortcut}
                                    </span>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
