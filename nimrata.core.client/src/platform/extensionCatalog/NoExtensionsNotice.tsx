import { useExtensions } from './useExtensions';
import './ExtensionsEditor.css';

import type { ReactNode } from 'react';

/**
 * Пустое состояние рабочей области: пока отключены все расширения, вместо содержимого
 * показывает подсказку открыть «Вид → Расширения»; иначе выводит вложенные элементы
 */
export function NoExtensionsNotice({ children }: { children: ReactNode }) {
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
