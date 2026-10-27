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
 * Команда-шаблон «Открыть в дереве» (параметр-ссылка `target`): основа команд быстрого доступа
 */
export const OPEN_IN_TREE_COMMAND = 'openInTree';

/**
 * Тип корня «Активные»: здесь создают и ведут заметки
 */
export const ACTIVE_NOTES_ROOT = 'ActiveNotesRoot';
/**
 * Тип корня «Завершённые»: сюда действие «Завершить» переносит заметки
 */
export const COMPLETED_NOTES_ROOT = 'CompletedNotesRoot';
