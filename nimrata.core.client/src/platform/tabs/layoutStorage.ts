/**
 * Открытая вкладка
 */
export interface OpenTab {
    /** Идентификатор экземпляра вкладки */
    id: string;
    /** Идентификатор вида вкладки в реестре */
    kind: string;
}

/**
 * Раскладка, запоминаемая для пользователя
 */
export interface StoredLayout {
    /** Открытые вкладки по порядку */
    tabs: OpenTab[];
    /** Идентификатор активной вкладки */
    activeId: string | null;
    /** Ширины боковых панелей */
    widths: { left: number; right: number };
}

/**
 * Ключ `localStorage` для раскладки пользователя
 *
 * @param userId - идентификатор пользователя
 * @returns ключ хранилища
 */
const keyFor = (userId: string) => `nimrata.layout.${userId}`;

/**
 * Проверяет, что значение — объект
 *
 * @param value - проверяемое значение
 * @returns `true`, если это непустая ссылка на объект
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Проверяет, что значение — открытая вкладка
 *
 * @param value - проверяемое значение
 * @returns `true`, если у значения есть строковые `id` и `kind`
 */
function isOpenTab(value: unknown): value is OpenTab {
    return isRecord(value) && typeof value.id === 'string' && typeof value.kind === 'string';
}

/**
 * Проверяет, что значение — сохранённая раскладка
 *
 * @param value - проверяемое значение
 * @returns `true`, если форма значения соответствует `StoredLayout`
 */
function isLayout(value: unknown): value is StoredLayout {
    if (!isRecord(value)) return false;
    const { tabs, activeId, widths } = value;
    return (
        Array.isArray(tabs) &&
        tabs.every(isOpenTab) &&
        (activeId === null || typeof activeId === 'string') &&
        isRecord(widths) &&
        typeof widths.left === 'number' &&
        typeof widths.right === 'number'
    );
}

/**
 * Читает раскладку пользователя; при недоступном хранилище или мусоре возвращает `null`
 */
export function loadLayout(userId: string): StoredLayout | null {
    try {
        const raw = localStorage.getItem(keyFor(userId));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isLayout(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Сохраняет раскладку пользователя; ошибки хранилища игнорируются
 */
export function saveLayout(userId: string, layout: StoredLayout): void {
    try {
        localStorage.setItem(keyFor(userId), JSON.stringify(layout));
    } catch {
        // хранилище недоступно или переполнено: раскладка просто не запомнится
    }
}
