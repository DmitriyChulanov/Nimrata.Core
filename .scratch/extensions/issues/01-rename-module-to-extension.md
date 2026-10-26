# 01: Переименование «модуль» → «расширение»

**What to build:** Во всём коде и документации понятие «модуль» заменено на «расширение», поведение не меняется.

**Blocked by:** —

**Status:** resolved

- [x] Поле манифеста `module` → `extension`, колонка `types.module_id` → `extension_id` и `module_version` → `extension_version` (SQL-миграция), `ManifestLoader`/`ManifestValidator`, каталог `Modules/` сервера и его контент
- [x] Клиент: `src/modules/` → `src/extensions/`, алиас `@tracker` остаётся до тикета 02; lint-правило `no-restricted-imports` и `vite.config.ts` обновлены
- [x] Комментарии, `docs/configuration.md`, `docs/design-system.md`, `CLAUDE.md` и ADR 0001 не используют «модуль»
- [x] Тесты бэкенда (`dotnet test Nimrata.Core.slnx`), клиента (`npm test`, `npm run lint`) проходят без изменений поведения
- [x] Запись в `CHANGELOG.md` сервера и клиента

## Answer

Реализовано на ветке `integration/extensions` (коммит 06b0ffe). Build, 119 тестов бэкенда, 457 тестов клиента и lint проходят. Миграция 0019 проверена только на пустой БД, на БД с данными не гонялась.
