import { useExtensions } from './useExtensions';
import './ExtensionsEditor.css';

import type { ReactNode } from 'react';

/**
 * Свойства компонента `NoExtensionsNotice`
 */
interface NoExtensionsNoticeProps {
    /** Содержимое рабочей области, которое показывается, пока подключено хотя бы одно расширение */
    children: ReactNode;
}

/**
 * Пустое состояние рабочей области: пока отключены все расширения, вместо содержимого
 * показывает подсказку открыть «Вид → Расширения»; иначе выводит вложенные элементы
 *
 * @param props - свойства компонента, описаны в `NoExtensionsNoticeProps`
 * @returns подсказку или вложенные элементы
 */
export function NoExtensionsNotice({ children }: NoExtensionsNoticeProps) {
    const { status, extensions } = useExtensions();

    // Пустой каталог — не «всё отключено»: подключать нечего
    if (status === 'ready' && extensions.length > 0 && !extensions.some((e) => e.connected)) {
        return (
            <p className="extensions-empty">
                Все расширения отключены. Откройте «Вид → Расширения», чтобы подключить нужные.
            </p>
        );
    }
    return <>{children}</>;
}
