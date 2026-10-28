# 02: Реестр Действий и Команд вне `DataController`

**What to build:** Правила Действий и Команд живут в одном module и тестируются без `createFakeApi`; `DataController` делегирует.

**Blocked by:** 01

**Status:** resolved

- [x] Защитные тесты: существующие тесты `DataController.{commands,group,available}.test.ts` и `useActionLauncher` зелёные до рефакторинга; добавлены недостающие на тексты ошибок, отсутствие записи в Журнале при отказе до исполнения, скрытие недоступного Действия у одного Объекта и показ с причиной у группы
- [x] `createActionRegistry({ reader, execute })` (`reader` — `ObjectReader` из 01): `registerAction`, `registerCommand`, `isCommandAvailable`, `getActions`, `getActionParameters`, `getGroupActions`, `getGroupActionParameters`, `runAction`, `runActionOnMany`, `runCommand`, `missingRequired`
- [x] `runAction(id)` и `getActions(id)` — частные случаи группового пути; поведение и тексты ошибок сохранены
- [x] Правило «нет общих значений параметров» только в реестре; `useActionLauncher.launchMany` получает готовый результат (параметры для диалога либо причина недоступности) и не проверяет `null` сам
- [x] `DataController` отдаёт те же методы, делегируя реестру; interface и вызывающие (расширения, `PropertyGrid`, `useActionLauncher`) не меняются
- [x] Unit-тесты реестра с заглушкой `execute` и литералом `ObjectReader`
- [x] `npm test`, `npm run lint`; запись в `CHANGELOG.md` клиента

## Answer

Построен `platform/data/actionRegistry.ts` (`createActionRegistry({ reader, execute })`) со всеми перечисленными методами; `DataController` делегирует ему, `errorMessage` вынесен в `data/errorMessage.ts`. Одиночные `runAction` и `getActions` идут через групповой путь. Правило «нет общих значений параметров» только в реестре: добавлен метод `DataController.groupLaunch(ids, action)` (параметры либо причина), `useActionLauncher.launchMany` не проверяет `null`. Защитные тесты (`DataController.refusals.test.ts`, `useActionLauncher.test.tsx`) добавлены до рефакторинга и были зелёными; unit-тесты реестра на заглушке `execute` и литерале `ObjectReader`. Запись в `CHANGELOG.md` клиента добавлена. `npm run lint` и `tsc` чисто; тесты зелёные.

Принятые отличия: `groupLaunch` — добавление в interface `DataController` (иначе `launchMany` не получить готовый результат); он заменил `getGroupActionParameters`, который из interface `DataController` убран (снаружи реестра не использовался, остался только в реестре); отказ запуска (нет объекта, действия или обработчика, не заполнен обязательный параметр) определяется сразу, до очереди наборов (`resolveRun`), и повторяется внутри очереди; `runActionOnMany` с одним объектом пишет «У объекта…» с заглавной, как `runAction`.

Не проверялось: поведение в браузере вручную, бэкенд-тесты. Полный `npm test` на медленной машине даёт таймауты 5 с в посторонних файлах (UsersTab и др.); с увеличенным `--testTimeout` зелёный.
