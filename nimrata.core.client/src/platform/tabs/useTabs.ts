import { useContext } from 'react';

import { TabsContext } from '@platform/tabs/TabsContext';

import type { TabsValue } from '@platform/tabs/TabsContext';

/** Раскладка вкладок; бросает ошибку вне `TabsProvider` */
export function useTabs(): TabsValue {
    const value = useContext(TabsContext);
    if (!value) throw new Error('TabsProvider не найден в дереве компонентов.');
    return value;
}
