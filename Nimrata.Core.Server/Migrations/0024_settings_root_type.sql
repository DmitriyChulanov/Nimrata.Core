-- Платформенный тип «Настройки»: единственный корень, в котором у каждого расширения свой узел настроек.
-- Тип не принадлежит расширению (виден при любых подключениях); allowedChildren не задан, чтобы расширения
-- сами добавляли в него свои типы настроек (манифест не может ссылаться на чужие типы). Узлы настроек
-- расширений относятся к его типам и скрываются вместе с ним.
insert into types (id, extension_id, extension_version, definition)
values ('SettingsRoot', null, 1, '{
  "name": "Настройки",
  "sealed": true,
  "singleton": true,
  "icon": "settings",
  "iconColor": "gray"
}'::jsonb)
on conflict (id) do nothing;
