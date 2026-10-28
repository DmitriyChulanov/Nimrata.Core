import {
    Archive,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowsClockwise,
    Bell,
    Bookmark,
    Calendar,
    CalendarBlank,
    CalendarDot,
    CalendarDots,
    CaretDown,
    CaretRight,
    ChartBar,
    Check,
    CheckCircle,
    CheckSquare,
    Circle,
    Clock,
    Copy,
    Crosshair,
    Database,
    Envelope,
    File,
    FileText,
    FileXls,
    Flag,
    Folder,
    FolderOpen,
    Funnel,
    Gear,
    GitBranch,
    Globe,
    House,
    Info,
    Lightning,
    Link,
    List,
    ListBullets,
    ListChecks,
    Lock,
    MagnifyingGlass,
    Notebook,
    TreePalm,
    Pencil,
    Play,
    Plus,
    Question,
    SignOut,
    Sparkle,
    Square,
    Stack,
    Star,
    Sun,
    Tag,
    Target,
    Trash,
    Tray,
    TreeStructure,
    User,
    Users,
    Warning,
    WarningCircle,
    X,
    type Icon as PhosphorIcon,
    type IconWeight,
} from '@phosphor-icons/react';

/**
 * Запись реестра: компонент Phosphor и вес. Цельные иконки имеют вес `fill`,
 * служебные линейные по природе (стрелки, плюс, крестик, галочка, меню) — `bold`
 */
export interface IconDefinition {
    component: PhosphorIcon;
    weight: IconWeight;
}

/**
 * Реестр иконок платформы: имя в kebab-case → компонент и вес.
 * Типы расширений ссылаются на иконку только этим именем (имена стабильны и хранятся в БД).
 * Новая иконка добавляется сюда.
 */
export const ICON_REGISTRY = {
    archive: { component: Archive, weight: 'fill' },
    'arrow-down': { component: ArrowDown, weight: 'bold' },
    'arrow-left': { component: ArrowLeft, weight: 'bold' },
    'arrow-right': { component: ArrowRight, weight: 'bold' },
    'arrow-up': { component: ArrowUp, weight: 'bold' },
    bell: { component: Bell, weight: 'fill' },
    bookmark: { component: Bookmark, weight: 'fill' },
    calendar: { component: Calendar, weight: 'fill' },
    'calendar-1': { component: CalendarDot, weight: 'fill' },
    'calendar-days': { component: CalendarDots, weight: 'fill' },
    'calendar-range': { component: CalendarBlank, weight: 'fill' },
    'chart-column': { component: ChartBar, weight: 'fill' },
    check: { component: Check, weight: 'bold' },
    'chevron-down': { component: CaretDown, weight: 'bold' },
    'chevron-right': { component: CaretRight, weight: 'bold' },
    circle: { component: Circle, weight: 'fill' },
    'circle-alert': { component: WarningCircle, weight: 'fill' },
    'circle-check': { component: CheckCircle, weight: 'fill' },
    'circle-help': { component: Question, weight: 'fill' },
    clock: { component: Clock, weight: 'fill' },
    copy: { component: Copy, weight: 'fill' },
    crosshair: { component: Crosshair, weight: 'fill' },
    database: { component: Database, weight: 'fill' },
    file: { component: File, weight: 'fill' },
    'file-spreadsheet': { component: FileXls, weight: 'fill' },
    'file-text': { component: FileText, weight: 'fill' },
    filter: { component: Funnel, weight: 'fill' },
    flag: { component: Flag, weight: 'fill' },
    folder: { component: Folder, weight: 'fill' },
    'folder-open': { component: FolderOpen, weight: 'fill' },
    'git-branch': { component: GitBranch, weight: 'fill' },
    globe: { component: Globe, weight: 'fill' },
    house: { component: House, weight: 'fill' },
    inbox: { component: Tray, weight: 'fill' },
    info: { component: Info, weight: 'fill' },
    layers: { component: Stack, weight: 'fill' },
    link: { component: Link, weight: 'bold' },
    'list-checks': { component: ListChecks, weight: 'bold' },
    'list-todo': { component: ListBullets, weight: 'bold' },
    lock: { component: Lock, weight: 'fill' },
    'log-out': { component: SignOut, weight: 'fill' },
    mail: { component: Envelope, weight: 'fill' },
    menu: { component: List, weight: 'bold' },
    notebook: { component: Notebook, weight: 'fill' },
    palmtree: { component: TreePalm, weight: 'fill' },
    pencil: { component: Pencil, weight: 'fill' },
    play: { component: Play, weight: 'fill' },
    plus: { component: Plus, weight: 'bold' },
    'refresh-cw': { component: ArrowsClockwise, weight: 'bold' },
    search: { component: MagnifyingGlass, weight: 'bold' },
    settings: { component: Gear, weight: 'fill' },
    sparkles: { component: Sparkle, weight: 'fill' },
    square: { component: Square, weight: 'fill' },
    'square-check-big': { component: CheckSquare, weight: 'fill' },
    star: { component: Star, weight: 'fill' },
    sun: { component: Sun, weight: 'fill' },
    tag: { component: Tag, weight: 'fill' },
    target: { component: Target, weight: 'fill' },
    'trash-2': { component: Trash, weight: 'fill' },
    'triangle-alert': { component: Warning, weight: 'fill' },
    user: { component: User, weight: 'fill' },
    users: { component: Users, weight: 'fill' },
    workflow: { component: TreeStructure, weight: 'fill' },
    x: { component: X, weight: 'bold' },
    zap: { component: Lightning, weight: 'fill' },
} as const satisfies Record<string, IconDefinition>;

/**
 * Имя иконки, существующее в реестре
 */
export type IconName = keyof typeof ICON_REGISTRY;

/**
 * Иконка, которую показывают, когда имя не задано или не найдено в реестре
 */
export const FALLBACK_ICON: IconName = 'circle';

/**
 * Проверяет, что строка — имя иконки из реестра
 *
 * @param name - проверяемая строка
 * @returns `true`, если иконка есть в реестре
 */
export function isIconName(name: string): name is IconName {
    return Object.hasOwn(ICON_REGISTRY, name);
}
