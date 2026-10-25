export interface OpenTab {
    /** Идентификатор экземпляра вкладки */
    id: string;
    /** Идентификатор вида вкладки в реестре */
    kind: string;
}

export interface StoredLayout {
    tabs: OpenTab[];
    activeId: string | null;
    widths: { left: number; right: number };
}

const keyFor = (userId: string) => `nimrata.layout.${userId}`;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isOpenTab(value: unknown): value is OpenTab {
    return isRecord(value) && typeof value.id === 'string' && typeof value.kind === 'string';
}

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

/** Читает раскладку пользователя; при недоступном хранилище или мусоре возвращает `null` */
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

/** Сохраняет раскладку пользователя; ошибки хранилища игнорируются */
export function saveLayout(userId: string, layout: StoredLayout): void {
    try {
        localStorage.setItem(keyFor(userId), JSON.stringify(layout));
    } catch {
        // хранилище недоступно или переполнено: раскладка просто не запомнится
    }
}
