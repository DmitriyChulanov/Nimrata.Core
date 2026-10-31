# 06: Service worker — запуск без сети

**What to build:** Приложение открывается без сети, если пользователь уже входил: клиентскую оболочку кэширует service worker.

**Blocked by:** 05

**Status:** resolved

- [x] `vite-plugin-pwa` (`generateSW`): кэш собранных ассетов и `index.html`, `navigateFallback`; `/api` не перехватывается
- [x] Обновление до новой версии без навязчивых диалогов; dev-режим не ломается
- [x] Сервер раздаёт SW из `wwwroot` с корректными заголовками кэширования
- [x] Проверка: сборка, запуск, перезагрузка без сети в браузере; `npm run build`, `npm test`, `npm run lint`; `CHANGELOG.md` клиента

## Comments

- Ветка `sync/06-service-worker`. `vite-plugin-pwa` 2.0.0 (`generateSW`), настройки в `nimrata.core.client/pwa.config.ts` (тест `pwa.config.test.ts`: denylist навигации `/api`, `/health`, `/openapi`, нет runtimeCaching, autoUpdate, dev выключен). `manifest: false` — установка как PWA не нужна. Сервер: `ClientCaching` — `no-cache` для `sw.js`, `registerSW.js`, `index.html` (и SPA-fallback), `immutable` для `/assets/*`; тесты в `SpaHostingTests`.
- Браузер (Chrome через DevTools, опубликованный сервер в Production на http://localhost:5199): вход → SW активен, страница под контролем, кэш `workbox-precache-v2`; затем сервер остановлен (и сеть эмулирована офлайн) → перезагрузка и переход на `/tracker/tasks/42` открывают оболочку с деревом из IndexedDB, `fetch('/api/...')` даёт `TypeError` (не синтетический ответ). Встроенный браузер Claude не регистрирует SW (`An unknown error occurred when fetching the script`), поэтому проверка — в Chrome.
