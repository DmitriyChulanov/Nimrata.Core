# 02: Реестр Действий и Команд вне `DataController`

**What to build:** Правила Действий и Команд живут в одном module и тестируются без `createFakeApi`; `DataController` делегирует.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Защитные тесты: существующие тесты `DataController.{commands,group,available}.test.ts` и `useActionLauncher` зелёные до рефакторинга; добавлены недостающие на тексты ошибок, отсутствие записи в Журнале при отказе до исполнения, скрытие недоступного Действия у одного Объекта и показ с причиной у группы
- [ ] `createActionRegistry({ reader, execute })` (`reader` — `ObjectReader` из 01): `registerAction`, `registerCommand`, `isCommandAvailable`, `getActions`, `getActionParameters`, `getGroupActions`, `getGroupActionParameters`, `runAction`, `runActionOnMany`, `runCommand`, `missingRequired`
- [ ] `runAction(id)` и `getActions(id)` — частные случаи группового пути; поведение и тексты ошибок сохранены
- [ ] Правило «нет общих значений параметров» только в реестре; `useActionLauncher.launchMany` получает готовый результат (параметры для диалога либо причина недоступности) и не проверяет `null` сам
- [ ] `DataController` отдаёт те же методы, делегируя реестру; interface и вызывающие (расширения, `PropertyGrid`, `useActionLauncher`) не меняются
- [ ] Unit-тесты реестра с заглушкой `execute` и литералом `ObjectReader`
- [ ] `npm test`, `npm run lint`; запись в `CHANGELOG.md` клиента
