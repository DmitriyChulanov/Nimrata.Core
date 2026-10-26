// Идентификаторы типов манифеста Трекера и значения свойств, на которые опирается логика

/**
 * Тип корня всех задач
 */
export const TASKS_ROOT = 'TasksRoot';
/**
 * Тип корня текущих задач
 */
export const CURRENT_TASKS_ROOT = 'CurrentTasksRoot';
/**
 * Тип корня завершённых задач (архив)
 */
export const COMPLETED_TASKS_ROOT = 'CompletedTasksRoot';
/**
 * Тип корня заметок
 */
export const NOTES_ROOT = 'NotesRoot';

/**
 * Тип узла-года
 */
export const YEAR = 'Year';
/**
 * Тип узла-месяца
 */
export const MONTH = 'Month';
/**
 * Тип узла-дня
 */
export const DAY = 'Day';
/**
 * Тип узла выходного дня
 */
export const DAY_OFF = 'DayOff';
/**
 * Типы узлов-дней: обычный и выходной
 */
export const DAY_TYPES = [DAY, DAY_OFF];
/**
 * Тип категории задач внутри дня
 */
export const CATEGORY = 'Category';
/**
 * Тип задачи
 */
export const TASK = 'Task';

/**
 * Тип заметки
 */
export const NOTE = 'Note';
/**
 * Тип группы заметок
 */
export const NOTE_GROUP = 'NoteGroup';

/**
 * Запись быстрого доступа: механизм (скрыт в дереве) со ссылкой `target` на заметку или группу
 */
export const QUICK_ACCESS_ENTRY = 'QuickAccessEntry';
/**
 * Механизм «Выделить текущий день»: единственный объект, скрытый в дереве
 */
export const SELECT_TODAY = 'SelectTodayMechanism';

/**
 * Значение статуса «Завершена» у задачи и заметки
 */
export const COMPLETED = 'completed';
