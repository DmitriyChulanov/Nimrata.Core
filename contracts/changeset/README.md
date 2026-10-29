# Контракт Набора изменений

Сценарии, общие для клиентского `fakeApi` и реального сервера. Правило меняется в одном месте: сценарий добавляется сюда, и оба раннера его проверяют.

- `types.json` — типы расширения `demo` (в формате манифеста). Типы платформы `SettingsRoot` и `CustomCommand` берутся из миграций сервера `0023`, `0024` и из `PLATFORM_TYPES` в `fakeApi`.
- `parent.json`, `singleton.json`, `disabled.json`, `values.json`, `was.json` — `{ "scenarios": [...] }`.

Сценарий:

```json
{
  "name": "описание",
  "extensionEnabled": false,
  "objects": [{ "id": "<guid>", "type": "Folder", "parent": null, "number": 1, "properties": {} }],
  "operations": [{ "op": "create", "id": "<guid>", "type": "Item", "parent": null, "number": 1, "properties": {} }],
  "expect": { "ok": false, "code": "singleton_exists", "conflict": true }
}
```

- `extensionEnabled` — подключено ли расширение `demo` (по умолчанию да); `objects` — начальные Объекты пользователя, родители раньше потомков.
- `expect.ok` — принят ли набор; `expect.code` — машинный код ошибки (`extension_disabled`, `singleton_exists`), если он есть; `expect.conflict` — отказ из-за расхождения с данными (HTTP 409). Текст причины не сравнивается.

Раннеры: `nimrata.core.client/src/platform/data/fakeApi.contract.test.ts` (Vitest) и `Nimrata.Core.Server.Tests/ChangesetContractTests.cs` (xUnit, Testcontainers).
