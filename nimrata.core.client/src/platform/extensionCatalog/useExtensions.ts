import { useContext } from 'react';

import { ExtensionsContext } from '@platform/extensionCatalog/ExtensionsContext';

import type { ExtensionsValue } from '@platform/extensionCatalog/ExtensionsContext';

/**
 * Каталог расширений и переключение подключений; бросает ошибку вне `ExtensionsProvider`
 */
export function useExtensions(): ExtensionsValue {
    const value = useContext(ExtensionsContext);
    if (!value) throw new Error('ExtensionsProvider не найден в дереве компонентов.');
    return value;
}
