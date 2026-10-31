# 01: Сервер — курсор, пакетная запись, LWW, догон

**What to build:** Сервер присваивает наборам монотонный `seq`, принимает пакет наборов с клиентскими `id` и отбрасывает повторы. Конфликты решаются по LWW со строгими структурными инвариантами. Сервер отдаёт изменения с курсора и согласованную полную загрузку.

**Blocked by:** —

**Status:** resolved

- [x] Миграция: `changesets.seq bigint generated always as identity` (уникальный индекс)
- [x] `POST /api/changesets` → `{ changesets: [{ id, operations }] }`, ответ 200 со списком `{ id, status: applied | duplicate | rejected, seq?, code?, detail? }`; каждый набор — своя транзакция; 4xx только на формат и авторизацию
- [x] Идемпотентность: повтор известного `id` → `duplicate` с прежним `seq`, без повторного применения
- [x] `pg_advisory_xact_lock` по пользователю на время применения набора; тест: порядок `seq` совпадает с порядком фиксации
- [x] LWW: `update` и `move` (`parent`, `number`) не сверяют «было», журнал пишет фактическое старое значение; структурные инварианты (существование, `allowedChildren`, цикл, singleton, включённое расширение, дети удаляемого, дубликат `create`) остаются отказом
- [x] Контракт `contracts/changeset`: пересмотреть категорию `was` (README, сценарии); серверные и клиентские контрактные тесты зелёные (`fakeApi` следует новому контракту)
- [x] `GET /api/changes?since=N` → `{ toSeq, changesetIds, upserts, deletes }` либо `{ resync: true }` при превышении порога; фильтр видимости как в `GET objects`
- [x] Полная загрузка в `repeatable read` возвращает `seq` снимка (форма ответа согласуется с клиентом в 02)
- [x] Секция настроек `Sync:` (`ResyncThreshold`, `PushWindow`) и `docs/configuration.md`
- [x] Клиентский `DataController` минимально переведён на новый формат запроса и ответа (без двух слоёв — это 02), чтобы приложение работало
- [x] Тесты сервера (HTTP + Testcontainers), `dotnet test`, `npm test`; запись в `CHANGELOG.md` сервера

## Comments

Сделано в ветке `sync/01-server`:
- Миграция `0026_changesets_seq.sql`: `seq` identity, уникальный индекс, индекс `(user_id, seq)`. `id` набора присылает клиент.
- `POST /api/changesets`: пакет `{ changesets: [{ id, operations }] }` → 200 `[{ id, status, seq?, code?, detail? }]`. Набор — своя транзакция под `pg_advisory_xact_lock(hashtextextended('changesets:{userId}', 0))`. Повтор `id` — `duplicate` с прежним `seq`, `id` чужого набора — `rejected`, отклонённый набор не запоминается (повтор с тем же `id` применяется заново). 400 — только формат пакета.
- LWW в `ChangesetService`: `old` необязателен и не сверяется, журнал пишет фактическое прежнее значение. `ChangesetRejectedException.Conflict` удалён.
- `GET /api/changes?since=N` → `{ toSeq, changesetIds, upserts, deletes }` или `{ resync: true }` (наборов больше порога либо курсор новее последнего набора пользователя). Объекты, скрытые отключённым расширением, попадают в `deletes`.
- Полная загрузка — новый `GET /api/snapshot` → `{ seq, types, objects }` (repeatable read, read only); `seq` — последний набор пользователя, 0 — наборов нет. `GET /api/objects` и `/api/types` оставлены, клиент пока грузит через них: переход на snapshot — в 02.
- `Sync:ResyncThreshold`, `Sync:PushWindow` (`SyncOptions`, проверка при старте), описаны в `docs/configuration.md`.
- Контракт: признак `conflict` убран, `was.json` переписан под LWW. `fakeApi` следует контракту. `DataController` шлёт пакет с UUIDv7 набора и переводит `rejected` в прежний `ApiError(422, detail, code)`. `needsReload` пока жив (срабатывает только на HTTP 409, которого сервер больше не шлёт), убрать в 02.
