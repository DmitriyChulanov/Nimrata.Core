// Расширение «Трекер задач»: логика (хуки, действия, стартовая структура) подключается к
// контроллеру данных. Расширение импортирует платформу через алиас; обратное и импорт других
// расширений запрещены lint-правилом
export { ensureTasksStart, registerTasks, taskDate, tasksExtension } from './tasksExtension';
export { NotificationsBinding } from './NotificationsBinding';
export { ensureRepeats } from './repeats';
