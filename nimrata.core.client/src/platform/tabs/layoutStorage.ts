export interface OpenTab {
    /** Идентификатор экземпляра вкладки. */
    id: string;
    /** Идентификатор вида вкладки в реестре. */
    kind: string;
}

export interface StoredLayout {
    tabs: OpenTab[];
    activeId: string | null;
    widths: { left: number; right: number };
}

const keyFor = (userId: string) => `nimrata.layout.${userId}`;

function isLayout(value: unknown): value is StoredLayout {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<StoredLayout>;
    return (
        Array.isArray(v.tabs) &&
        v.tabs.every((t) => t && typeof t.id === 'string' && typeof t.kind === 'string') &&
        (v.activeId === null || typeof v.activeId === 'string') &&
        !!v.widths &&
        typeof v.widths.left === 'number' &&
        typeof v.widths.right === 'number'
    );
}

/** Читает раскладку пользователя; при недоступном хранилище или мусоре возвращает `null`. */
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

/** Сохраняет раскладку пользователя; ошибки хранилища игнорируются. */
export function saveLayout(userId: string, layout: StoredLayout): void {
    try {
        localStorage.setItem(keyFor(userId), JSON.stringify(layout));
    } catch {
        // хранилище недоступно или переполнено: раскладка просто не запомнится
    }
}
