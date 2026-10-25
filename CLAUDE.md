# Nimrata.Core

Шаблонный проект: ASP.NET Core (.NET 10) + React 19 + Vite + TypeScript.

## Структура
- `Nimrata.Core.Server/` — бэкенд (Web API, контроллеры в `Controllers/`, OpenAPI в Development).
- `nimrata.core.client/` — фронтенд (Vite, алиас `@` → `src`).
- `Nimrata.Core.Server.Tests/` — тесты бэкенда (xUnit).
- `Nimrata.Core.slnx` — solution со всеми проектами.

## Команды
- Сервер (поднимает и Vite через SpaProxy): `dotnet run --project Nimrata.Core.Server --launch-profile https`
- Сборка бэкенда: `dotnet build Nimrata.Core.slnx`
- Тесты бэкенда: `dotnet test Nimrata.Core.slnx`
- Клиент, из `nimrata.core.client/`: `npm run dev`, `npm run build`, `npm run lint`, `npm test` (Vitest + Testing Library), `npm run format`

## Порты
- Бэкенд: https://localhost:7146, http://localhost:5134
- Vite dev-сервер: https://localhost:61625 (HTTPS, сертификат из `dotnet dev-certs`)

## Соглашения
- Все серверные маршруты API живут под единым префиксом `/api`; он проксируется одним правилом `^/api` в `server.proxy` (`nimrata.core.client/vite.config.ts`), новые маршруты отдельно в прокси добавлять не нужно. Клиент обращается к API через `createApiClient` (`@platform`).
- Клиент разделён на `src/platform/` (алиас `@platform`) и `src/modules/tracker/` (алиас `@tracker`); `platform/` не импортирует из модулей (проверяет ESLint `no-restricted-imports`).
- `WeatherForecast*` — демо-код шаблона, его можно удалять.
- Изменения фиксируются в `CHANGELOG.md` соответствующего проекта.
- Коммиты и комментарии — на русском.

## Проверка изменений
- После правок запускать `dotnet test Nimrata.Core.slnx`, а для клиента `npm test` и `npm run lint`; новая логика покрывается тестами.
- Стиль задаёт `.editorconfig` (C#) и `nimrata.core.client/.prettierrc.json` (клиент). Хук `.claude/hooks/format.mjs` сам форматирует изменённые `.cs`, `.ts`, `.tsx`, `.css`, `.json`.

## Навигация по коду
- Для структурных вопросов (кто вызывает, зависимости, архитектура) использовать граф `codebase-memory-mcp`: `search_graph`, `trace_path`, `get_architecture`. Проект в индексе: `C-Repositories-Nimrata.Core`.
- `Grep`/`Glob` — для поиска литералов, текста и конфигов, а также если файла нет в индексе.
- После крупных изменений структуры переиндексировать: `index_repository` с `repo_path` = корень репозитория.

## Agent skills

### Issue tracker

Задачи и спецификации — локальные markdown-файлы в `.scratch/`. См. `docs/agents/issue-tracker.md`.

### Triage labels

Стандартные метки: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. См. `docs/agents/triage-labels.md`.

### Domain docs

Single-context: один `GLOSSARY.md` и `docs/adr/` в корне. См. `docs/agents/domain.md`.
