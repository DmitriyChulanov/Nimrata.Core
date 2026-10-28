# 04: Подключение расширений — module без React

**What to build:** Цикл «синхронизировать регистрации → загрузить данные → проверить статус → запустить расширения» существует в одном месте и тестируется без рендера.

**Blocked by:** —

**Status:** resolved

- [x] Module подключения расширений без React: `initialize` и `setConnected` с отменой устаревшего запуска и блокировкой; сброс выделения передаётся callback'ом, о `Selection` module не знает (ADR 0003)
- [x] `ensureStart.reload` использует тот же цикл «загрузить → проверить статус»
- [x] `ExtensionsProvider` остаётся тонкой обёрткой над состоянием для React и подписывается на события module
- [x] Unit-тесты module без рендера: гонка `initialize` и `setConnected`, повторный вызов при занятости, ошибка загрузки, сброс выделения
- [x] `ExtensionsProvider.test.tsx` остаётся зелёным; поведение для пользователя не меняется
- [x] `npm test`, `npm run lint`; запись в `CHANGELOG.md` клиента

## Answer

Построен module `createExtensionLifecycle` (`platform/extensionCatalog/extensionLifecycle.ts`): `initialize`, `reload`, `setConnected`, `dispose`, `getState`/`subscribe`; устаревший запуск отменяется поколением, переключение блокируется, сброс выделения передаётся callback-ом `onDataReloaded` (о `Selection` module не знает). Цикл «загрузить → проверить статус» вынесен в `reloadData` (`extensionApi/reloadData.ts`) и используется module и `ensureStart.ensureCreated`. `ExtensionsProvider` стал обёрткой над `useSyncExternalStore`. 16 unit-тестов без рендера (гонка, занятость, ошибка загрузки, сброс выделения и др.); `ExtensionsProvider.test.tsx` зелёный без правок; `npm test` (645) и `npm run lint` проходят; запись в `CHANGELOG.md` есть.

Не проверено: ручная работа в браузере. В `ExtensionsProvider` оставлен `eslint-disable react-hooks/refs` (правило не отличает колбэк с ref от чтения при рендере).
