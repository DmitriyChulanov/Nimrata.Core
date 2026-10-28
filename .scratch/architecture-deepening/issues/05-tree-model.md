# 05: Модель дерева `treeModel` и reveal

**What to build:** Видимые строки дерева и раскрытие предков при reveal — чистый module; `Tree` и выбор ссылки используют один и тот же порядок.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Module `treeModel` (чистые функции над `ObjectReader` и множеством `expanded`): `visibleChildren`, `flatten`, раскрытие предков через `ancestors` из `objectQueries`; сортировка `order` → название (collator `ru`) → id, фильтр `hiddenInTree`; `hasChildren` без повторной сортировки
- [ ] `Tree.tsx`, дословная копия в `ReferenceEditor.tsx` и `siblingsOf` (для `planMove` и Alt+стрелок) берут порядок из `treeModel`
- [ ] Раскрытие предков при reveal — через функцию модели; `setState` в render заменён так, чтобы правило `react-hooks` не отключалось; `revealBridge`, `RevealBinding`, `seq` и скролл не меняются
- [ ] Характеризующий тест `clipboard.ts` (`topLevelIds`, `copySubtrees`, порядок удаления): совпадает ли порядок с видимым; при расхождении порядок выравнивается по `treeModel`, объекты с `hiddenInTree` копируются и удаляются как раньше
- [ ] Unit-тесты `treeModel` и `planMove` на литерале `ObjectReader`; тест `Tree` с reveal (раскрытие предков и прокрутка к строке), которого сейчас нет
- [ ] Жесты (`selectRow`, горячие клавиши, drag), виртуализация, меню и чужие сортировки не тронуты
- [ ] `npm test`, `npm run lint`; запись в `CHANGELOG.md` клиента
