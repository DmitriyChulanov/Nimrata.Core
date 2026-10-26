-- Разделение расширения tracker на tasks («Трекер задач») и notes («Трекер заметок»).
-- Меняется только владелец типов: идентификаторы типов и объектов остаются прежними.
-- Миграции выполняются до загрузки манифестов, поэтому версии (11) сохраняются, а манифесты
-- tasks и notes версии 12 затем обновляют определения типов.
update types
set extension_id = 'notes'
where extension_id = 'tracker'
  and id in ('NotesRoot', 'NoteGroup', 'Note', 'QuickAccessEntry');

update types
set extension_id = 'tasks'
where extension_id = 'tracker';
