# Настройка и запуск

## Запуск одной командой

```
docker compose up --build
```

Поднимаются три контейнера: приложение (http://localhost:8080, сервер раздаёт собранный клиент), Postgres и Mailpit (веб-интерфейс почты http://localhost:8025, SMTP на 1025). На экране входа используйте администратора из настроек (по умолчанию `admin@nimrata.local` / `dev-admin-password` — только для локальной работы).

Значения по умолчанию в `docker-compose.yml` годятся только для локальной проверки. Для развёртывания скопируйте `.env.example` в `.env` (файл в git не попадает) и задайте свои значения.

## Настройки

Используется стандартная конфигурация ASP.NET Core: `appsettings*.json`, user-secrets, переменные окружения (вложенность — через `__`).

| Назначение | Ключ | Переменная окружения | Для compose (`.env`) |
|---|---|---|---|
| Строка подключения к Postgres | `ConnectionStrings:Default` | `ConnectionStrings__Default` | `POSTGRES_PASSWORD` (пароль БД) |
| Секрет подписи JWT (минимум 32 символа) | `Jwt:Key` | `Jwt__Key` | `JWT_KEY` |
| Первый администратор: e-mail | `Admin:Email` | `Admin__Email` | `ADMIN_EMAIL` |
| Первый администратор: пароль (минимум 8 символов) | `Admin:Password` | `Admin__Password` | `ADMIN_PASSWORD` |
| SMTP для писем (сброс пароля) | `Smtp:Host`, `Smtp:Port`, `Smtp:From`, `Smtp:User`, `Smtp:Password`, `Smtp:UseSsl` | `Smtp__Host`, `Smtp__Port`, … | задано на Mailpit в compose |
| Публичный адрес приложения (база ссылки в письме сброса пароля) | `PasswordReset:PublicUrl` | `PasswordReset__PublicUrl` | `http://localhost:8080` в compose |
| Срок жизни ссылки сброса, минут (по умолчанию 60) | `PasswordReset:LifetimeMinutes` | `PasswordReset__LifetimeMinutes` | — |

Первый администратор создаётся при старте, если пользователя с таким e-mail ещё нет; повторный запуск дубль не создаёт.

## Сброс пароля и почта

Пользователь нажимает «Забыли пароль?» на экране входа и получает письмо с одноразовой ссылкой (`<PublicUrl>/reset-password?token=…`, по умолчанию действует 60 минут); администратор может отправить такое же письмо из вкладки «Пользователи». Ответ на запрос сброса не зависит от того, есть ли такой e-mail. Новый пароль — не короче 8 символов; после смены все активные сессии пользователя завершаются.

В разработке письма перехватывает Mailpit (`docker compose up -d mailpit`): SMTP `localhost:1025`, веб-интерфейс почты — http://localhost:8025. Для развёртывания задайте `Smtp__Host`, `Smtp__Port`, `Smtp__From` (и при необходимости `Smtp__User`, `Smtp__Password`, `Smtp__UseSsl`), а также `PasswordReset__PublicUrl` — внешний адрес приложения.

## Разработка

- Postgres и Mailpit для разработки: `docker compose up -d postgres mailpit` (Postgres на порту 5433; параметры совпадают с `appsettings.Development.json`).
- Секреты разработки: в `appsettings.Development.json` лежат только dev-значения. Свои задаются через user-secrets, например `dotnet user-secrets set "Jwt:Key" "..." --project Nimrata.Core.Server`.
- Сервер вместе с Vite: `dotnet run --project Nimrata.Core.Server --launch-profile https` (https://localhost:7146, Vite — https://localhost:61625).

## Пересоздание базы данных

Структура данных расширений менялась без миграции существующих данных (корни «Активные» и «Завершённые» у заметок, команды вместо «Автоматизации» и механизмов, ADR 0004), поэтому в среде разработки БД пересоздаётся. Сброс volume Postgres удаляет все данные; при старте сервер заново применит SQL-миграции и создаст администратора из настроек, стартовые структуры расширений создаются при первом входе:

```
docker compose down -v
docker compose up -d postgres mailpit
```

Для запуска целиком — `docker compose down -v`, затем `docker compose up --build`. В развёртывании с настоящими данными volume (`nimrata-pgdata`) не удаляйте.

## Развёртывание

- Образ собирается `Nimrata.Core.Server/Dockerfile` (контекст — корень репозитория): стадия node собирает клиент, стадия .NET публикует сервер и кладёт сборку клиента в `wwwroot`.
- Без Docker: `dotnet publish Nimrata.Core.Server -c Release` сам выполняет `npm ci` и `npm run build` и включает результат в `wwwroot` публикации (флаг `-p:SkipClientBuild=true` — если клиент собран заранее в `nimrata.core.client/dist`).
- Секреты в продакшене задавайте переменными окружения или секрет-хранилищем оркестратора; значения по умолчанию из `docker-compose.yml` не использовать.

## Архитектурные правила платформы

- Бизнес-логика расширений выполняется на клиенте (`docs/adr/0001-client-side-business-logic.md`); сервер — общий слой хранения, проверок и журнала.
- Все маршруты API живут под `/api` и проксируются в dev одним правилом `^/api` (`nimrata.core.client/vite.config.ts`).
- `src/platform/` не импортирует из `src/extensions/*` (проверяет ESLint).
- Команды расширения описываются в манифесте (`commands`), код регистрируется на клиенте и запускается с панели «Команды» (`docs/adr/0004-commands-in-manifest-with-client-code.md`); вкладки «Автоматизация» и скрытых «механизмов» больше нет.
- Терминология — в `GLOSSARY.md`.
