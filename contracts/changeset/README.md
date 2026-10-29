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
  "expect": { "ok": false, "code": "singleton_exists" }
}
```

- `extensionEnabled` — подключено ли расширение `demo` (по умолчанию да); `objects` — начальные Объекты пользователя, родители раньше потомков.
- Раннер отправляет `operations` одним набором пакета `POST /api/changesets` (`{ changesets: [{ id, operations }] }`).
- `expect.ok` — применён ли набор (`status: applied`); `expect.code` — машинный код отказа (`extension_disabled`, `singleton_exists`), если он есть. Текст причины не сравнивается.

## «Было» и LWW (`was.json`)

Конфликты значений решаются по LWW: у `update` (свойства) и `move` (`parent`, `number`) «было» (`old`) необязательно и не сверяется с текущим значением. Применяется новое значение (`new`), а в журнал пишется фактическое прежнее. Клиент по-прежнему присылает `old`: оно нужно ему для отмены.

Отказом остаются только структурные инварианты: объект и родитель существуют, родитель допустим по `allowedChildren`, нет цикла, singleton, расширение подключено, у удаляемого нет детей вне набора, `create` с занятым `id`, значение подходит под вид свойства. Отказ отклоняет набор целиком.

Раннеры: `nimrata.core.client/src/platform/data/fakeApi.contract.test.ts` (Vitest) и `Nimrata.Core.Server.Tests/ChangesetContractTests.cs` (xUnit, Testcontainers).
