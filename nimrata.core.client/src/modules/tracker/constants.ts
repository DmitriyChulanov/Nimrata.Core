// Идентификаторы типов манифеста Трекера и значения свойств, на которые опирается логика

export const TASKS_ROOT = 'TasksRoot';
export const CURRENT_TASKS_ROOT = 'CurrentTasksRoot';
export const COMPLETED_TASKS_ROOT = 'CompletedTasksRoot';
export const NOTES_ROOT = 'NotesRoot';

export const YEAR = 'Year';
export const MONTH = 'Month';
export const DAY = 'Day';
export const DAY_OFF = 'DayOff';
/** Типы узлов-дней: обычный и выходной */
export const DAY_TYPES = [DAY, DAY_OFF];
export const CATEGORY = 'Category';
export const TASK = 'Task';

export const NOTE = 'Note';
export const NOTE_GROUP = 'NoteGroup';

/** Запись быстрого доступа: механизм (скрыт в дереве) со ссылкой `target` на заметку или группу */
export const QUICK_ACCESS_ENTRY = 'QuickAccessEntry';
/** Механизм «Выделить текущий день»: единственный объект, скрытый в дереве */
export const SELECT_TODAY = 'SelectTodayMechanism';

/** Значение статуса «Завершена» у задачи и заметки */
export const COMPLETED = 'completed';
