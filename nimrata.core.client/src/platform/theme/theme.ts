/** Выбор пользователя: системная тема следует настройке ОС */
export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'nimrata.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** Сохранённый выбор темы; без записи или при недоступном хранилище — системная */
export function readThemeChoice(): ThemeChoice {
    try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        return CHOICES.find((choice) => choice === value) ?? 'system';
    } catch {
        return 'system';
    }
}

function prefersDark(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** Применяет тему к документу: ставит `data-theme` со значением `light` или `dark` */
export function applyThemeChoice(choice: ThemeChoice): void {
    const dark = choice === 'dark' || (choice === 'system' && prefersDark());
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Запоминает выбор и сразу применяет его */
export function setThemeChoice(choice: ThemeChoice): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, choice);
    } catch {
        // хранилище недоступно: тема действует до перезагрузки
    }
    applyThemeChoice(choice);
}

/** Применяет сохранённую тему и следит за настройкой ОС; возвращает отписку */
export function initTheme(): () => void {
    applyThemeChoice(readThemeChoice());
    if (typeof window.matchMedia !== 'function') return () => undefined;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => {
        if (readThemeChoice() === 'system') applyThemeChoice('system');
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}
