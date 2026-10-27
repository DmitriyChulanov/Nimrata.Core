# 07: Документация и итоговая проверка

**What to build:** Документация описывает команды, панель и новую структуру заметок; всё проходит проверки.

**Blocked by:** 02, 03, 04, 05, 06

**Status:** needs-triage

- [ ] `docs/design-system.md`, `docs/configuration.md`, `CLAUDE.md`: упоминания «Автоматизации» и механизмов заменены
- [ ] Инструкция по пересозданию БД (сброс volume Postgres) в `docs/configuration.md`
- [ ] `dotnet test Nimrata.Core.slnx`, `npm test`, `npm run lint` зелёные
- [ ] Записи в `CHANGELOG.md` обоих проектов
