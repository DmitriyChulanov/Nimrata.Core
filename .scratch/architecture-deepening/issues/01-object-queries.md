# 01: Module `objectQueries`: Название объекта и обход родителей

**What to build:** Одно правило подписи Объекта и один обход родителей в платформе вместо пяти и семи копий.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] Module `objectQueries` в `platform` с узким `ObjectReader` (`getObject`, `getType`): `objectLabel` (Название объекта: `name`, иначе название типа, иначе идентификатор типа) и `ancestors` (с защитой от цикла и обрывом на отсутствующем родителе)
- [ ] Экспорт через `@platform`; ESLint `no-restricted-imports` не нарушен
- [ ] Заменены копии подписи: `Tree.titleOf`, `ReferenceEditor.titleOf`, `ActionDialog.titleOf` (для отсутствующего Объекта остаётся id на месте вызова), `DataController.objectLabel`, встроенная копия в `JournalTab`; `title` в подписи больше не участвует
- [ ] Заменены копии обхода: `tasks/nodes.ts` `ancestors`, `notes/notesExtension.ts` `ancestorsOf`, `tasks/tasks.ts` `taskDate`, `tasks/completion.ts` `categoryChain` и `pruneEmptyCategories`, встроенный обход в `Tree.tsx` (reveal) и проверка цикла в `planMove.ts`
- [ ] Unit-тесты `objectQueries` на литерале `ObjectReader` (без `createFakeApi`), включая цикл, сироту, объект без `name`, тип с `title` без `name`
- [ ] Серверный `IsAncestorAsync` не тронут
- [ ] `npm test`, `npm run lint`; запись в `CHANGELOG.md` клиента
