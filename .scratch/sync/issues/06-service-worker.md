# 06: Service worker — запуск без сети

**What to build:** Приложение открывается без сети, если пользователь уже входил: клиентскую оболочку кэширует service worker.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] `vite-plugin-pwa` (`generateSW`): кэш собранных ассетов и `index.html`, `navigateFallback`; `/api` не перехватывается
- [ ] Обновление до новой версии без навязчивых диалогов; dev-режим не ломается
- [ ] Сервер раздаёт SW из `wwwroot` с корректными заголовками кэширования
- [ ] Проверка: сборка, запуск, перезагрузка без сети в браузере; `npm run build`, `npm test`, `npm run lint`; `CHANGELOG.md` клиента
