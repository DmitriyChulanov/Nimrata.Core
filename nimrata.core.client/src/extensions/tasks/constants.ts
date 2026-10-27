// Идентификаторы типов манифеста Трекера задач и значения свойств, на которые опирается логика

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
 * Идентификатор команды «Выделить текущий день» в манифесте
 */
export const SELECT_TODAY_COMMAND = 'selectToday';
/**
 * Идентификатор команды «Создать расписание» в манифесте
 */
export const CREATE_SCHEDULE_COMMAND = 'createSchedule';

/**
 * Идентификатор команды «Отчёт по завершённым задачам» в манифесте
 */
export const COMPLETED_REPORT_COMMAND = 'completedReport';

/**
 * Значение статуса «Завершена» у задачи
 */
export const COMPLETED = 'completed';
