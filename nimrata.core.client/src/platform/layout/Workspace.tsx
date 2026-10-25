import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import './Workspace.css';

const MIN_WIDTH = 120;
const KEY_STEP = 20;

export interface WorkspaceWidths {
    left: number;
    right: number;
}

export interface WorkspaceProps {
    /** Дерево объектов. */
    left: ReactNode;
    /** Область вкладок. */
    center: ReactNode;
    /** Таблица свойств. */
    right: ReactNode;
    initialWidths?: WorkspaceWidths;
    /** Вызывается после каждого изменения ширины панелей (для запоминания раскладки). */
    onWidthsChange?: (widths: WorkspaceWidths) => void;
}

type Side = keyof WorkspaceWidths;

/** Основной экран: три панели, ширина боковых меняется перетаскиванием границ. */
export function Workspace({
    left,
    center,
    right,
    initialWidths = { left: 280, right: 320 },
    onWidthsChange,
}: WorkspaceProps) {
    const [widths, setWidths] = useState<WorkspaceWidths>(initialWidths);
    const notify = useRef(onWidthsChange);
    const initial = useRef(widths);

    useEffect(() => {
        notify.current = onWidthsChange;
    });

    useEffect(() => {
        if (widths !== initial.current) notify.current?.(widths);
    }, [widths]);
    const [drag, setDrag] = useState<{ side: Side; startX: number; startWidth: number } | null>(
        null,
    );

    useEffect(() => {
        if (!drag) return;
        const sign = drag.side === 'left' ? 1 : -1;
        const onMove = (e: MouseEvent) => {
            const width = Math.max(MIN_WIDTH, drag.startWidth + sign * (e.clientX - drag.startX));
            setWidths((prev) => ({ ...prev, [drag.side]: width }));
        };
        const onUp = () => setDrag(null);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
    }, [drag]);

    const handleProps = (side: Side, label: string) => ({
        role: 'separator' as const,
        'aria-orientation': 'vertical' as const,
        'aria-label': label,
        'aria-valuenow': widths[side],
        'aria-valuemin': MIN_WIDTH,
        tabIndex: 0,
        className: 'workspace-handle',
        onMouseDown: (e: React.MouseEvent) => {
            e.preventDefault();
            setDrag({ side, startX: e.clientX, startWidth: widths[side] });
        },
        onKeyDown: (e: KeyboardEvent) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const direction = e.key === 'ArrowRight' ? 1 : -1;
            const sign = side === 'left' ? 1 : -1;
            setWidths((prev) => ({
                ...prev,
                [side]: Math.max(MIN_WIDTH, prev[side] + sign * direction * KEY_STEP),
            }));
        },
    });

    return (
        <div className="workspace">
            <section role="region" aria-label="Дерево" style={{ width: widths.left }}>
                {left}
            </section>
            <div {...handleProps('left', 'Ширина дерева')} />
            <section role="region" aria-label="Вкладки" className="workspace-center">
                {center}
            </section>
            <div {...handleProps('right', 'Ширина свойств')} />
            <section role="region" aria-label="Свойства" style={{ width: widths.right }}>
                {right}
            </section>
        </div>
    );
}
