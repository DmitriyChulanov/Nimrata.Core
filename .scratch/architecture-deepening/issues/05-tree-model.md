# 05: Модель дерева `treeModel` и reveal

**What to build:** Видимые строки дерева и раскрытие предков при reveal — чистый module; `Tree` и выбор ссылки используют один и тот же порядок.

**Blocked by:** 01

**Status:** resolved

- [x] Module `treeModel` (чистые функции над `ObjectReader` и множеством `expanded`): `visibleChildren`, `flatten`, раскрытие предков через `ancestors` из `objectQueries`; сортировка `order` → название (collator `ru`) → id, фильтр `hiddenInTree`; `hasChildren` без повторной сортировки
- [x] `Tree.tsx`, дословная копия в `ReferenceEditor.tsx` и `siblingsOf` (для `planMove` и Alt+стрелок) берут порядок из `treeModel`
- [x] Раскрытие предков при reveal — через функцию модели; `setState` в render заменён так, чтобы правило `react-hooks` не отключалось; `revealBridge`, `RevealBinding`, `seq` и скролл не меняются
- [x] Характеризующий тест `clipboard.ts` (`topLevelIds`, `copySubtrees`, порядок удаления): совпадает ли порядок с видимым; при расхождении порядок выравнивается по `treeModel`, объекты с `hiddenInTree` копируются и удаляются как раньше
- [x] Unit-тесты `treeModel` и `planMove` на литерале `ObjectReader`; тест `Tree` с reveal (раскрытие предков и прокрутка к строке), которого сейчас нет
- [x] Жесты (`selectRow`, горячие клавиши, drag), виртуализация, меню и чужие сортировки не тронуты
- [x] `npm test`, `npm run lint`; запись в `CHANGELOG.md` клиента

## Answer

Построен `platform/tree/treeModel.ts` (`TreeReader`, `visibleChildren`, `childrenInOrder`, `hasChildren`, `flatten`, `expandToReveal`); `Tree`, выбор ссылки в `ReferenceEditor`, `siblingsOf` (для `planMove` и Alt+стрелок) и `clipboard.ts` берут порядок из модели, `planMove` принимает `ObjectReader`. Характеризующий тест `clipboard.test.ts` показал реальное расхождение: при равном `order` буфер обмена (и удаление группы) шёл по id, дерево — по названию; порядок выровнен по `treeModel`, потомки `hiddenInTree` копируются как раньше. Раскрытие предков при reveal — `expandToReveal` внутри прежней подстройки состояния при рендере (`revealBridge`, `RevealBinding`, `seq`, скролл не менялись; правила `react-hooks` не отключались, существующее отключение `exhaustive-deps` у `rows` осталось). Тесты: `treeModel.test.ts` (включая `planMove` на литерале), `Tree.reveal.test.tsx` (раскрытие предков и прокрутка), запись в `CHANGELOG.md`. `npm test` (654 теста; один раз `UsersTab` упал под нагрузкой и прошёл при повторе) и `npm run lint` проходят.

Не проверялось: поведение в браузере вручную, бэкенд-тесты.
