-- Команды расширения (ADR 0004): описываются в манифесте и обновляются из него при каждом старте.
alter table extensions add column commands jsonb not null default '[]'::jsonb;

-- Платформенный скрытый тип «Пользовательская команда»: ссылка на команду расширения и сохранённые параметры.
-- Тип не принадлежит расширению (виден и создаётся при любых подключениях); к расширению относит поле extension,
-- панель команд скрывает такие объекты вместе с отключённым расширением. params — JSON-объект строкой.
insert into types (id, extension_id, extension_version, definition)
values ('CustomCommand', null, 1, '{
  "name": "Пользовательская команда",
  "sealed": true,
  "hiddenInTree": true,
  "allowedChildren": [],
  "properties": [
    { "id": "name", "name": "Название", "kind": "string", "category": "Основное" },
    { "id": "extension", "name": "Расширение", "kind": "string", "category": "Основное", "readOnly": true },
    { "id": "command", "name": "Команда", "kind": "string", "category": "Основное", "readOnly": true },
    { "id": "params", "name": "Параметры", "kind": "text", "hidden": true, "readOnly": true }
  ],
  "icon": "play",
  "iconColor": "gray"
}'::jsonb)
on conflict (id) do nothing;
