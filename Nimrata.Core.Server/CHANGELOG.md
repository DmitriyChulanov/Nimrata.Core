# Changelog сервера

## Не выпущено

### Добавлено
- Каркас сервера: Npgsql, Dapper и DbUp; пронумерованные SQL-миграции (`Migrations/*.sql`, встроены в сборку) применяются при старте.
- Первая миграция `0001_schema_info.sql` (служебная таблица `app_info`).
- Обработчик Dapper `JsonbTypeHandler` для колонок `jsonb` (`JsonElement`).
- Конечная точка `GET /health` (проверка соединения с БД).
- Строка подключения `ConnectionStrings:Default` из настроек или переменной окружения `ConnectionStrings__Default`; для разработки значения заданы в `appsettings.Development.json`.
- `docker-compose.yml` в корне репозитория с Postgres (порт 5433, пароль переопределяется `POSTGRES_PASSWORD`).
- Тестовый стенд: `WebApplicationFactory` + Testcontainers (Postgres), интеграционный тест здоровья и миграций.

- Вход и первый администратор: миграция `0002_users_and_refresh_tokens.sql` (пользователи, refresh-токены); эндпоинты `POST /api/auth/login`, `/refresh`, `/logout`, `GET /api/auth/me`; пароли через `PasswordHasher` (минимум 8 символов); access JWT на 15 минут, refresh (30 дней, в БД хранится только хеш) в HttpOnly-cookie `SameSite=Strict`, ротируется при обновлении и отзывается при выходе; отключённый пользователь не может войти и обновить токен.
- JwtBearer; всё API закрыто по умолчанию (fallback-политика), открыты только `/health`, статика и эндпоинты входа.
- Первый администратор создаётся при старте из `Admin:Email` / `Admin:Password` (user-secrets или `Admin__Email`/`Admin__Password`), повторный запуск дубль не создаёт. Ключ подписи — `Jwt:Key` (user-secrets или `Jwt__Key`); в `appsettings.Development.json` лежат только dev-значения.
- Интеграционные тесты HTTP API входа (`AuthTests`).

- Единый деплой: сервер раздаёт собранный клиент из `wwwroot` (`UseStaticFiles`) и отдаёт `index.html` для неизвестных маршрутов вне `/api`; `dotnet publish` собирает клиент (`npm ci`, `npm run build`) и включает его в `wwwroot` (`-p:SkipClientBuild=true` — использовать готовый `dist`). Тесты SPA-хостинга (`SpaHostingTests`).
- `Dockerfile` собирает приложение целиком (node-стадия, публикация, runtime); `docker-compose.yml` поднимает приложение, Postgres (с healthcheck) и Mailpit одной командой; `.env.example`, `docs/configuration.md` с перечнем настроек.
- Итог пилота: вход по e-mail и паролю с refresh-токенами и первым администратором, Postgres + DbUp-миграции, единый деплой одним образом. Остальной объём пилота (объекты и журнал, UI платформы, модуль Трекер) фиксируется в записях соответствующих тикетов.

### Удалено
- Демо-код шаблона `WeatherForecast*` и его тест; прокси `/weatherforecast` в Vite.
