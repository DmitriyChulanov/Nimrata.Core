// Модуль Трекер: логика (хуки, действия, стартовая структура) подключается к контроллеру данных.
// Модуль может импортировать платформу через алиас; обратное запрещено lint-правилом.
export { ensureStartStructure, noteName, registerTracker, taskDate } from './tracker';
export { NotificationsBinding } from './NotificationsBinding';
export { RevealBinding } from './RevealBinding';
export { createRevealBridge } from './revealBridge';
export { ensureRepeats } from './repeats';
