import type { SVGProps } from 'react';

/**
 * Свойства значка: стандартные свойства SVG без вложенных элементов
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

/**
 * Основа значка: рисует SVG 16×16 линией цвета текста
 *
 * @param props - вложенные фигуры и свойства SVG
 * @returns скрытый от вспомогательных технологий значок
 */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            {...props}
        >
            {children}
        </svg>
    );
}

/**
 * Стрелка раскрытия узла: вправо — свёрнут, вниз — раскрыт
 */
export function ChevronIcon({ open, ...props }: IconProps & { open: boolean }) {
    return (
        <Icon {...props}>
            <path d={open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'} />
        </Icon>
    );
}

/**
 * Крестик закрытия
 */
export function CloseIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M4 4l8 8M12 4l-8 8" />
        </Icon>
    );
}

/**
 * Выход из системы
 */
export function LogoutIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10 5l3 3-3 3M13 8H6" />
        </Icon>
    );
}
