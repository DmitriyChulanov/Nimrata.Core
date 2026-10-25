# Nimrata.Core

Шаблонный проект: ASP.NET Core (.NET 10) + React 19 + Vite + TypeScript.

## Структура
- `Nimrata.Core.Server/` — бэкенд (Web API, контроллеры в `Controllers/`, OpenAPI в Development).
- `nimrata.core.client/` — фронтенд (Vite, алиас `@` → `src`).
- `Nimrata.Core.slnx` — solution с обоими проектами.

## Команды
- Сервер (поднимает и Vite через SpaProxy): `dotnet run --project Nimrata.Core.Server --launch-profile https`
- Сборка бэкенда: `dotnet build Nimrata.Core.slnx`
- Клиент, из `nimrata.core.client/`: `npm run dev`, `npm run build`, `npm run lint`

## Порты
- Бэкенд: https://localhost:7146, http://localhost:5134
- Vite dev-сервер: https://localhost:61625 (HTTPS, сертификат из `dotnet dev-certs`)

## Соглашения
- Новые API-маршруты нужно добавлять в `server.proxy` в `nimrata.core.client/vite.config.ts` (сейчас проксируется только `/weatherforecast`).
- `WeatherForecast*` — демо-код шаблона, его можно удалять.
- Изменения фиксируются в `CHANGELOG.md` соответствующего проекта.
- Коммиты и комментарии — на русском.
