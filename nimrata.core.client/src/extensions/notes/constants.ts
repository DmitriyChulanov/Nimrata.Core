// Идентификаторы типов манифеста Трекера заметок

/**
 * Тип корня заметок
 */
export const NOTES_ROOT = 'NotesRoot';
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
 * Тип корня «Активные»: здесь создают и ведут заметки
 */
export const ACTIVE_NOTES_ROOT = 'ActiveNotesRoot';
/**
 * Тип корня «Завершённые»: сюда действие «Завершить» переносит заметки
 */
export const COMPLETED_NOTES_ROOT = 'CompletedNotesRoot';
