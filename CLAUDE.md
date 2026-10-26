# Nimrata.Core

Nimrata — веб-платформа автоматизации (ASP.NET Core .NET 10 + React 19 + Vite + TypeScript + Postgres) и её первое расширение Трекер. Термины — в `GLOSSARY.md`; ключевое решение — бизнес-логика расширений на клиенте, см. `docs/adr/0001-client-side-business-logic.md`. Настройки и развёртывание — `docs/configuration.md`. Правила оформления интерфейса (токены, UI-кит, иконки) — `docs/design-system.md`; читать перед любыми правками UI.

## Структура
- `Nimrata.Core.Server/` — бэкенд (Web API под `/api`, `Controllers/`, `Auth/`, `Data/`, SQL-миграции `Migrations/`, OpenAPI в Development). В продакшене раздаёт собранный клиент из `wwwroot`.
- `nimrata.core.client/` — фронтенд (Vite). `src/platform/` (`@platform`) — общие компоненты и API-клиент платформы; `src/extensions/` (`tasks` — `@tasks`, `notes` — `@notes`) — расширения; `@` → `src`.
- `Nimrata.Core.Server.Tests/` — тесты бэкенда (xUnit, Testcontainers/Postgres).
- `Nimrata.Core.slnx` — solution со всеми проектами.
- `docker-compose.yml`, `Nimrata.Core.Server/Dockerfile` — запуск целиком (приложение + Postgres + Mailpit).

## Команды
- Сервер (поднимает и Vite через SpaProxy): `dotnet run --project Nimrata.Core.Server --launch-profile https` (нужен Postgres: `docker compose up -d postgres mailpit`)
- Всё приложение в контейнерах: `docker compose up --build` → http://localhost:8080
- Сборка бэкенда: `dotnet build Nimrata.Core.slnx`
- Тесты бэкенда: `dotnet test Nimrata.Core.slnx` (нужен Docker для Testcontainers; на старом Docker задать `DOCKER_API_VERSION`)
- Публикация сервера вместе с клиентом: `dotnet publish Nimrata.Core.Server -c Release` (собирает клиент и кладёт в `wwwroot`)
- Клиент, из `nimrata.core.client/`: `npm run dev`, `npm run build`, `npm run lint` (ESLint и stylelint), `npm run lint:css` (только стили), `npm test` (Vitest + Testing Library), `npm run format`

## Порты
- Бэкенд: https://localhost:7146, http://localhost:5134
- Vite dev-сервер: https://localhost:61625 (HTTPS, сертификат из `dotnet dev-certs`)

## Соглашения
- Все серверные маршруты API живут под единым префиксом `/api`; он проксируется одним правилом `^/api` в `server.proxy` (`nimrata.core.client/vite.config.ts`), новые маршруты отдельно в прокси добавлять не нужно. Клиент обращается к API через `createApiClient` (`@platform`).
- Клиент разделён на `src/platform/` (алиас `@platform`) и `src/extensions/tasks/`, `src/extensions/notes/` (алиасы `@tasks`, `@notes`); `platform/` не импортирует из расширений, а расширения друг из друга (проверяет ESLint `no-restricted-imports`); расширение описывается клиентским дескриптором (`ExtensionDescriptor`) в реестре `extensionRegistry`, `App` расширений по именам не знает.
- Неизвестные маршруты вне `/api` сервер отдаёт как клиентское приложение (SPA-fallback); опечатка в `/api/...` даёт не-успешный ответ, а не `index.html`.
- Секреты (`Jwt:Key`, пароли) не кладём в репозиторий: user-secrets или переменные окружения/`.env` (шаблон — `.env.example`).
- Оформление интерфейса: значения цветов и размеров только токенами из `tokens.css`, элементы из UI-кита `platform/ui/`, иконки по имени из реестра; подробности в `docs/design-system.md`.
- Изменения фиксируются в `CHANGELOG.md` соответствующего проекта.
- Коммиты и комментарии — на русском.

## Проверка изменений
- После правок запускать `dotnet test Nimrata.Core.slnx`, а для клиента `npm test` и `npm run lint`; новая логика покрывается тестами.
- Для UI-правок: проверить обе темы, видимый фокус и контраст AA; `npm run lint` запускает stylelint, который запрещает цвета и литералы оформления вне `tokens.css`.
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
