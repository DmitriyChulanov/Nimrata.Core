# 01: Module `objectQueries`: Название объекта и обход родителей

**What to build:** Одно правило подписи Объекта и один обход родителей в платформе вместо пяти и семи копий.

**Blocked by:** —

**Status:** resolved

- [x] Module `objectQueries` в `platform` с узким `ObjectReader` (`getObject`, `getType`): `objectLabel` (Название объекта: `name`, иначе название типа, иначе идентификатор типа) и `ancestors` (с защитой от цикла и обрывом на отсутствующем родителе)
- [x] Экспорт через `@platform`; ESLint `no-restricted-imports` не нарушен
- [x] Заменены копии подписи: `Tree.titleOf`, `ReferenceEditor.titleOf`, `ActionDialog.titleOf` (для отсутствующего Объекта остаётся id на месте вызова), `DataController.objectLabel`, встроенная копия в `JournalTab`; `title` в подписи больше не участвует
- [x] Заменены копии обхода: `tasks/nodes.ts` `ancestors`, `notes/notesExtension.ts` `ancestorsOf`, `tasks/tasks.ts` `taskDate`, `tasks/completion.ts` `categoryChain` и `pruneEmptyCategories`, встроенный обход в `Tree.tsx` (reveal) и проверка цикла в `planMove.ts`
- [x] Unit-тесты `objectQueries` на литерале `ObjectReader` (без `createFakeApi`), включая цикл, сироту, объект без `name`, тип с `title` без `name`
- [x] Серверный `IsAncestorAsync` не тронут
- [x] `npm test`, `npm run lint`; запись в `CHANGELOG.md` клиента

## Answer

Построен `platform/objectQueries/objectQueries.ts` (`ObjectReader`, `objectLabel`, `ancestors`), экспорт через `@platform`, unit-тесты на литерале `ObjectReader` (цикл, сирота, без `name`, `title` без `name`). Заменены копии подписи (`Tree`, `ReferenceEditor`, `ActionDialog` — id для отсутствующего Объекта остаётся на месте вызова, `DataController`, `JournalTab`) и обхода (`tasks/nodes.ts`, `notesExtension.ts`, `taskDate`, `categoryChain`, `pruneEmptyCategories`, reveal в `Tree`, проверка цикла в `planMove`). Серверный `IsAncestorAsync` не тронут; запись в `CHANGELOG.md` клиента добавлена. `npm test` (638 тестов) и `npm run lint` проходят.

Не проверялось: поведение в браузере вручную, бэкенд-тесты.
