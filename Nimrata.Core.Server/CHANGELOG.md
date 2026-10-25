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

### Удалено
- Демо-код шаблона `WeatherForecast*` и его тест; прокси `/weatherforecast` в Vite.
