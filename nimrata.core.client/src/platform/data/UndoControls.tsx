import { useEffect, useState } from 'react';

import type { MenuRegistry } from '../tabs/registries';
import type { ChangeResult } from './DataController';
import { useData } from './DataProvider';

function isTextInput(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return (
        target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
    );
}

/**
 * Отмена и повтор для пользователя: пункты «Правка → Отменить / Повторить» в реестре меню,
 * горячие клавиши (Ctrl/Cmd+Z, Ctrl+Y, Ctrl/Cmd+Shift+Z) и сообщение об отказе сервера.
 * В полях ввода клавиши остаются за браузером.
 */
export function UndoControls({ registry }: { registry: MenuRegistry }) {
    const data = useData();
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        const run = async (action: () => Promise<ChangeResult>) => {
            const result = await action();
            setNotice(result.ok ? null : result.error);
        };
        const undo = () => run(() => data.undo());
        const redo = () => run(() => data.redo());

        const stops = [
            registry.register({
                path: ['Правка', 'Отменить'],
                shortcut: 'Ctrl+Z',
                enabled: () => data.canUndo(),
                subscribe: data.subscribe,
                run: () => void undo(),
            }),
            registry.register({
                path: ['Правка', 'Повторить'],
                shortcut: 'Ctrl+Y',
                enabled: () => data.canRedo(),
                subscribe: data.subscribe,
                run: () => void redo(),
            }),
        ];

        const onKey = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || isTextInput(event.target))
                return;
            const key = event.key.toLowerCase();
            if (key === 'z' && !event.shiftKey) {
                event.preventDefault();
                void undo();
            } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
                event.preventDefault();
                void redo();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            stops.forEach((stop) => stop());
        };
    }, [data, registry]);

    if (!notice) return null;
    return (
        <p role="alert" className="undo-notice">
            {notice}{' '}
            <button type="button" onClick={() => setNotice(null)}>
                Закрыть
            </button>
        </p>
    );
}
