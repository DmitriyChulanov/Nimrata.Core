# Changelog сервера

## Не выпущено

### Документация (синхронизация)
- ADR 0006 «Синхронизация: журнал как курсор, SignalR-push, офлайн-очередь, LWW» описывает серверную часть как построено: `seq` и advisory-блокировка, идемпотентность по `id`, LWW со структурными отказами, пакет `POST /api/changesets`, `GET /api/snapshot`, догон `GET /api/changes`, хаб `/api/sync` с `fromSeq` и `resync`. Термины Синхронизация, Курсор, Подтверждённое состояние, Очередь неподтверждённых — в `GLOSSARY.md`. Код сервера не менялся.

### Добавлено (синхронизация: push по SignalR)
- SignalR-хаб `/api/sync` (`Sync/SyncHub.cs`): соединение входит в группу `user:{id}`; клиент получает `changes` — формат догона с добавленным `fromSeq` (`ChangesPush`: `{ fromSeq, toSeq, changesetIds, upserts, deletes }`) — и `resync`. JWT из query `access_token` принимается только на пути хаба (`JwtBearerEvents.OnMessageReceived`); остальное API его из query не берёт.
- `IChangeNotifier` и диспетчер `ChangeDispatcher` (внутри процесса): `ChangesetService.ApplyAsync` помечает автора «грязным» сразу после фиксации набора (повтор `duplicate` и отказ — нет). Первое уведомление открывает окно `Sync:PushWindow`, по его истечении журнал читается из БД после последнего отправленного `seq` через `SyncService.ReadChangesAsync` и рассылается группе одним сообщением. Наборов больше `Sync:ResyncThreshold` (в том числе когда рассылка отстала из-за медленного клиента) — вместо потока `resync`; ошибка рассылки — `resync` в следующем окне. Пользователи без соединений не учитываются.
- `PUT /api/extensions/{id}/connection` рассылает вкладкам пользователя `resync`.
- Тесты `SyncHubTests` (`Microsoft.AspNetCore.SignalR.Client`, WebSocket через `TestServer`): две вкладки пользователя, чужой пользователь ничего не получает, группировка в окне, продолжение с последнего отправленного `seq`, `duplicate` без рассылки, `resync` по порогу и по смене подключения расширения, хаб без токена, `access_token` вне хаба. `DemoServer`: токены пользователей и `CreateHubConnection`.

### Изменено (синхронизация: курсор, пакетная запись, LWW, догон)
- Миграция `0026_changesets_seq.sql`: `changesets.seq bigint generated always as identity` с уникальным индексом и индексом `(user_id, seq)`. Идентификатор набора теперь присылает клиент.
- `POST /api/changesets` принимает пакет `{ changesets: [{ id, operations }] }` и всегда отвечает 200 списком `[{ id, status: applied | duplicate | rejected, seq?, code?, detail? }]` в порядке пакета. Каждый набор — своя транзакция, отказ одного не откатывает остальные. Повтор известного `id` того же пользователя — `duplicate` с прежним `seq`, без повторного применения; `id` чужого набора — `rejected`. 400 — только ошибка формата пакета (нет `changesets`, у набора нет `id`-GUID или непустого `operations`), 401 — без токена. Прежних ответов 409/422 на набор больше нет.
- Наборы пользователя применяются под `pg_advisory_xact_lock` по пользователю: порядок `seq` совпадает с порядком фиксации, курсор не проскакивает незафиксированный набор. Отдельная блокировка singleton убрана, её покрывает блокировка пользователя.
- LWW: `update` (свойства) и `move` (`parent`, `number`) больше не сверяют «было», `old` необязательно; в журнал пишется фактическое прежнее значение. Отказом остаются структурные инварианты (существование объекта и родителя, `allowedChildren`, цикл, singleton, включённое расширение, дети удаляемого, занятый `id` при `create`, значение свойства). `ChangesetRejectedException.Conflict` удалено.
- Новое: `GET /api/changes?since=N` (`SyncController`, `SyncService.ReadChangesAsync`) — `{ toSeq, changesetIds, upserts, deletes }` в одном снимке `repeatable read`: `upserts` — финальное состояние видимых затронутых объектов, `deletes` — удалённые или скрытые отключённым расширением; `{ resync: true }`, если наборов после курсора больше `Sync:ResyncThreshold` или курсор новее последнего набора пользователя. Неверный `since` — 400.
- Новое: `GET /api/snapshot` — `{ seq, types, objects }` в одной транзакции `repeatable read`; `seq` — курсор последнего набора пользователя (0 — наборов нет). `GET /api/objects` и `GET /api/types` остаются.
- Секция настроек `Sync` (`SyncOptions`: `ResyncThreshold` = 5000, `PushWindow` = 100 мс) с проверкой при старте; описана в `docs/configuration.md`.
- Контракт `contracts/changeset/` пересмотрен под LWW: сценарии `was.json` с несовпавшим «было» теперь принимаются, добавлены сценарии без «было» и без «стало»; признак `conflict` из сценариев убран. Тесты переведены на пакетный формат (`ChangesetApi`, `DemoServer`), добавлены `ChangesetBatchTests`, `SyncTests`, `SyncOptionsTests`.

### Изменено («Номер» объекта)
- Миграция `0025_objects_number.sql`: `objects.sort_order` (double) заменено целым `number` (`NOT NULL DEFAULT 1`, проверка `>= 1`). `ObjectRecord.Order` → `Number`. В операциях набора изменений `create` и `move` поле `order` стало `number`: целое ≥ 1, иначе отказ 422; без `number` при создании — 1; `move` проверяет «было» по `number` (409 при расхождении). `GET api/objects` сортирует по `number`. Обновлены контрактные сценарии `contracts/changeset/` и тесты.

### Добавлено (контракт Набора изменений)
- Тесты `ChangesetContractTests`: JSON-сценарии `contracts/changeset/` (родитель, singleton, `extension_disabled`, значения свойств, «было») прогоняются против реального сервера (Testcontainers) и сверяются по признаку успеха, коду ошибки и конфликту (409); те же сценарии проверяет клиентский `fakeApi`. Поведение сервера не менялось.

### Добавлено (таблица свойств: сквозной порядок)
- `ManifestValidator`: необязательное числовое поле `order` у свойства и действия (сквозной порядок строк таблицы свойств) и необязательное строковое поле `category` у действия.

### Добавлено (настройки расширений, ADR 0005)
- Миграция `0024_settings_root_type.sql`: платформенный singleton-тип `SettingsRoot` («Настройки») без расширения и без `allowedChildren`; в нём расширения размещают свои узлы настроек.

### Добавлено (дерево объектов)
- `ManifestValidator`: необязательное поле `icon` действия — строка с именем иконки.

### Документация (команды, ADR 0004)
- `docs/configuration.md`: инструкция по пересозданию БД (сброс volume Postgres через `docker compose down -v`) и правило про команды вместо «Автоматизации».

### Добавлено (команды, ADR 0004)
- `ManifestValidator`: необязательная секция `commands` расширения (`id` уникален, `name`, `icon` обязательны, `description` — строка, `template` — логическое, `parameters` по правилам параметров действий).
- Миграция `0023_extension_commands_and_custom_command.sql`: колонка `extensions.commands` (jsonb, обновляется `ManifestLoader` из манифеста при каждом старте) и платформенный скрытый тип `CustomCommand` («Пользовательская команда»: `name`, `extension`, `command`, `params`; без расширения, виден и создаётся при любых подключениях).
- `GET /api/extensions` отдаёт `commands` расширения. Манифесты `tasks` и `notes` повышены до версии 14; команда `selectToday` («Выделить текущий день») объявлена в `tasks`.

### Удалено
- Флаг типа `automation` (валидатор отклоняет его с пояснением) и место показа действия `automation`; тип `SelectTodayMechanism` убран из манифеста `tasks` (уже созданные строки типа в БД остаются, лоадер удалённые типы не убирает).

### Исправлено
- Перемещение (`move` по `parent`) объекта-singleton под родителя, где такой объект уже есть у владельца, отклоняется с 409 и `code: "singleton_exists"` под той же advisory-блокировкой; смена только порядка и перемещение к свободному родителю допускаются.
- `ManifestLoader` обновляет метаданные расширения (название, описание, иконка, `defaultEnabled`) из манифеста при каждом старте, независимо от версии; типы по-прежнему применяются только при более новой версии.
- `ExtensionInfo` вынесен в отдельный файл; в комментарии миграции `0020` исправлена версия манифестов (13).

### Добавлено
- Подключения расширений на сервере (ADR 0003): миграция `0021_extensions_and_connections.sql` (таблица `extensions` с метаданными из манифестов, `user_extensions` «пользователь × расширение × включено» с `on delete cascade` по пользователю, функция `is_extension_enabled`; `types.extension_id` допускает NULL для типов платформы). Нет записи подключения — действует `defaultEnabled`.
- Метаданные расширения в манифесте (`name`, `description`, `icon`, `defaultEnabled`, обязательны) и `singleton` у типа (логическое); `ManifestValidator` запрещает `allowedChildren` на тип другого расширения, `ManifestLoader` проверяет это по всем манифестам каталога. Версии манифестов `tasks` и `notes` подняты до 13.
- `GET /api/extensions` (каталог из манифестов: `id`, `name`, `description`, `icon`, `defaultEnabled`, `connected`) и `PUT /api/extensions/{id}/connection` (тело `{ "connected": bool }`, меняет подключение вошедшего пользователя, возвращает элемент каталога; неизвестное расширение — 404, тело без `connected` — 400).
- `GET /api/objects` не возвращает объекты типов отключённых расширений, типы платформы видны всегда. Создание, изменение, перемещение и удаление таких объектов, создание и перемещение под родителя скрытого типа отклоняются в `POST /api/changesets` с 422 и причиной «Расширение отключено», телом ProblemDetails с полем `code: "extension_disabled"`; набор отклоняется целиком.
- `singleton`: второй объект такого типа у того же родителя и владельца отклоняется с 409 и `code: "singleton_exists"` (в `TasksRoot`, `CurrentTasksRoot`, `CompletedTasksRoot`, `NotesRoot`, `SelectTodayMechanism`); проверка под advisory-блокировкой транзакции.
- Журнал: миграция `0022_changeset_entries_type_id.sql` добавляет `changeset_entries.type_id` (пишет `ChangesetService`), бэкфилл с временным отключением триггера неизменяемости: живые объекты — из `objects`, удалённые — из `snapshot` или записи `create` того же объекта, иначе NULL. `GET /api/journal` скрывает записи отключённых расширений (NULL-тип виден всегда), `total` и пагинация считаются по тому же фильтру.
- Тесты `ExtensionsTests`, `ExtensionsMigrationTests` (миграция и бэкфилл на базе с данными) и дополнения `ManifestValidatorTests`, `ManifestTests`.

### Изменено
- Расширение `tracker` разделено на `tasks` («Трекер задач») и `notes` («Трекер заметок»): два манифеста версии 12 (`src/extensions/tasks` и `src/extensions/notes`), миграция `0020_split_tracker_extension.sql` переназначает владельца типов (`NotesRoot`, `NoteGroup`, `Note`, `QuickAccessEntry` — `notes`, остальных — `tasks`) до загрузки манифестов; идентификаторы типов и объектов не меняются. Тест миграции на базе с данными `tracker` (`TrackerSplitMigrationTests`), проверка обоих манифестов валидатором.
- Переименование «модуль» → «расширение» без смены поведения: поле манифеста `module` → `extension`, поля API типов `module`/`moduleVersion` → `extension`/`extensionVersion`, каталог `Modules/` → `Extensions/` (пространство имён `Nimrata.Core.Server.Extensions`, настройка `Extensions:Path`); миграция `0019_types_extension_columns.sql` переименовывает колонки `types.module_id` → `extension_id`, `module_version` → `extension_version` и индекс.
- Рефакторинг по соглашению csharp-dotnet: XML-комментарии в многострочной форме с `param`/`returns` у членов контроллеров, настроек и тестов, кириллица убрана из идентификаторов.

### Добавлено
- Каркас сервера: Npgsql, Dapper и DbUp; пронумерованные SQL-миграции (`Migrations/*.sql`, встроены в сборку) применяются при старте.
- Первая миграция `0001_schema_info.sql` (служебная таблица `app_info`).
- Обработчик Dapper `JsonbTypeHandler` для колонок `jsonb` (`JsonElement`).
- Конечная точка `GET /health` (проверка соединения с БД).
- Строка подключения `ConnectionStrings:Default` из настроек или переменной окружения `ConnectionStrings__Default`; для разработки значения заданы в `appsettings.Development.json`.
- `docker-compose.yml` в корне репозитория с Postgres (порт 5433, пароль переопределяется `POSTGRES_PASSWORD`).
- Тестовый стенд: `WebApplicationFactory` + Testcontainers (Postgres), интеграционный тест здоровья и миграций.

- Вход и первый администратор: миграция `0002_users_and_refresh_tokens.sql` (пользователи, refresh-токены); эндпоинты `POST /api/auth/login`, `/refresh`, `/logout`, `GET /api/auth/me`; пароли через `PasswordHasher` (минимум 8 символов); access JWT на 15 минут, refresh (30 дней, в БД хранится только хеш) в HttpOnly-cookie `SameSite=Strict`, ротируется при обновлении и отзывается при выходе; отключённый пользователь не может войти и обновить токен.
- JwtBearer; всё API закрыто по умолчанию (fallback-политика), открыты только `/health`, статика и эндпоинты входа.
- Первый администратор создаётся при старте из `Admin:Email` / `Admin:Password` (user-secrets или `Admin__Email`/`Admin__Password`), повторный запуск дубль не создаёт. Ключ подписи — `Jwt:Key` (user-secrets или `Jwt__Key`); в `appsettings.Development.json` лежат только dev-значения.
- Интеграционные тесты HTTP API входа (`AuthTests`).

- Единый деплой: сервер раздаёт собранный клиент из `wwwroot` (`UseStaticFiles`) и отдаёт `index.html` для неизвестных маршрутов вне `/api`; `dotnet publish` собирает клиент (`npm ci`, `npm run build`) и включает его в `wwwroot` (`-p:SkipClientBuild=true` — использовать готовый `dist`). Тесты SPA-хостинга (`SpaHostingTests`).
- `Dockerfile` собирает приложение целиком (node-стадия, публикация, runtime); `docker-compose.yml` поднимает приложение, Postgres (с healthcheck) и Mailpit одной командой; `.env.example`, `docs/configuration.md` с перечнем настроек.
- Итог пилота: вход по e-mail и паролю с refresh-токенами и первым администратором, Postgres + DbUp-миграции, единый деплой одним образом. Остальной объём пилота (объекты и журнал, UI платформы, модуль Трекер) фиксируется в записях соответствующих тикетов.
- Манифест модуля и типы: миграция `0003_types.sql` (таблица `types`); при старте `ManifestLoader` читает `Modules/*/manifest.json`, проверяет формат (`ManifestValidator`: восемь видов свойств, перечисления, abstract/sealed, допустимые дочерние типы, `hiddenInTree`, `automation`, действия с `placements` и параметрами, цветовые правила) и вставляет или обновляет типы, если версия манифеста выше сохранённой; невалидный манифест останавливает старт с перечнем ошибок. Манифест Трекера подключён в сборку как контент из клиентской части; каталог можно переопределить `Modules:Path`.
- `GET /api/types` — типы для авторизованного пользователя (определение плюс `module`, `moduleVersion`).
- Интеграционные тесты манифеста (`ManifestTests`).

- Объекты и наборы изменений: миграция `0004_objects_and_journal.sql` (таблицы `objects`, `changesets`, `changeset_entries`; триггеры запрещают правку и удаление журнала в БД, кода, правящего журнал, в приложении нет).
- `GET /api/objects` — все объекты текущего пользователя и только они (`id`, `type`, `parent`, `order`, `properties`).
- `POST /api/changesets` — набор операций `create`, `update` (свойства с `old`/`new`), `move` (`parent`/`order` с `old`/`new`), `delete` применяется в одной транзакции: либо все, либо ни одной. Проверки: объект принадлежит пользователю (чужой и несуществующий неразличимы), «было» совпадает с текущим (иначе 409), значение подходит виду свойства и перечислению (в том числе ссылки на свои объекты нужного типа), тип известен и не абстрактный, родитель существует и допустим по `allowedChildren`, нет цикла при перемещении, идентификатор не занят (409), удаление только объектов без потомков (набор перечисляет всё поддерево). Отказ: 422/409 с `{ "error": "причина" }`.
- В журнал пишутся записи «было/стало» и полный снимок удалённого объекта. Null в журнале хранится как SQL NULL.
- Интеграционные тесты HTTP API (`ObjectsTests`).
- Админка пользователей (только роль «Администратор», иначе 403): `GET /api/admin/users`, `POST /api/admin/users` (e-mail, имя, пароль не короче 8 символов, роль `admin`/`member`; дубль e-mail — 409), `PUT /api/admin/users/{id}/role`, `POST /api/admin/users/{id}/disable` и `/enable`; пользователей не удаляют. Последнего действующего администратора нельзя отключить или понизить (409 с причиной; проверка в транзакции с блокировкой строк). Отключение отзывает все refresh-токены пользователя. Миграция `0017_users_display_name.sql` (имя пользователя). Тесты `AdminUsersTests`. Роль берётся из access-токена, поэтому смена роли и отключение действуют на уже выданный access-токен до его истечения (15 минут).

### Удалено
- Демо-код шаблона `WeatherForecast*` и его тест; прокси `/weatherforecast` в Vite.

- Журнал: `GET /api/journal?objectId=&skip=&take=` — записи журнала текущего пользователя от новых к старым (`id`, `changesetId`, `at`, `user`, `objectId`, `operation`, `property`, `old`, `new`, `snapshot`) и `total`; без `objectId` — «все мои изменения», `take` от 1 до 200 (по умолчанию 50), неверные параметры дают 400. Чужие записи не возвращаются (по чужому объекту — пустая выдача), записи удалённых объектов остаются со снимком. Эндпоинта правки или удаления нет. Интеграционные тесты `JournalTests`.

- Сброс пароля по e-mail (тикет 18): миграция `0018_password_reset_tokens.sql`; `POST /api/auth/forgot-password` (всегда `202`, не раскрывает наличие пользователя; письмо уходит только действующему пользователю) и `POST /api/auth/reset-password` (`204`/`400`; одноразовая ссылка с ограниченным сроком, в БД только хеш; смена пароля отзывает все refresh-токены, минимум 8 символов, слабый пароль ссылку не сжигает); `POST /api/admin/users/{id}/password-reset` — то же письмо по инициативе администратора.
- Почта: интерфейс `IEmailSender`, SMTP-реализация (`Smtp:Host/Port/From/User/Password/UseSsl`), настройки `PasswordReset:LifetimeMinutes` (по умолчанию 60) и `PasswordReset:PublicUrl` (база ссылки в письме; из заголовков запроса не берётся). В `docker-compose.yml` письма перехватывает Mailpit (http://localhost:8025).
- Тесты: юнит-тесты токенов и письма (`PasswordResetUnitTests`), интеграционные тесты HTTP API с поддельной почтой (`PasswordResetTests`: запрос, истёкшая и повторно использованная ссылка, неизвестный e-mail, админская отправка).

- Правки по код-ревью интеграционной ветки: манифест Трекера v9 (у корня «Задачи» разрешены потомки «Текущие задачи» и «Завершённые задачи» — раньше пустой `allowedChildren` отклонял стартовую структуру с 422; значки типов; признак `revealTarget` у ссылки «Цель»). `ManifestValidator` проверяет `revealTarget` (логическое значение, только для вида `reference`). Тесты без БД `ManifestValidatorTests`: манифест Трекера проходит валидатор, корни задач допускают оба потомка.
- Манифесты модулей подключаются в сборку маской `src/modules/*/manifest.json` клиентской части (путь в выходной папке прежний — `Modules/<модуль>/manifest.json`); `Dockerfile` копирует каталог модулей целиком.
- Из файлов ветки убран UTF-8 BOM (`appsettings.Development.json`, `docker-compose.yml` и другие): `.editorconfig` требует `utf-8` без BOM.

### Изменено
- Профиль запуска «Container (Dockerfile)»: строка подключения к Postgres на хосте (`host.docker.internal:5433`), чтобы отладка в контейнере не упиралась в `localhost` самого контейнера.
- Dockerfile: первой стадией добавлен `base` (aspnet), `final` строится от неё; отладка в контейнере из Rider/VS собирает образ до `base` и больше не падает на alpine-стадии клиента (`exec ...JetBrains.Debugger.Worker: no such file or directory`).
- Рефакторинг по соглашениям `csharp-dotnet`: идентификаторы переведены на латиницу, один публичный тип — один файл (`Auth/`, `Controllers/Requests`, `Controllers/Responses`, `Objects/`), `CancellationToken` пробрасывается от контроллеров до запросов, время берётся из `TimeProvider`, XML-комментарии без точки в конце.
- SQL из контроллеров журнала, объектов и типов вынесен в сервисы `JournalService`, `ObjectsService`, `TypesService`; общие `Passwords`, `OpaqueTokens`, `Roles` и `GetUserId()` заменили дубли в сервисах и контроллерах.
- Ошибки API отдаются как `ProblemDetails` (`application/problem+json`): сообщение для пользователя лежит в поле `detail` вместо прежнего `error`; параметры `skip`/`take` журнала проверяются атрибутами `[Range]`.
- Первый администратор создаётся через `await` в `Program.cs` вместо блокирующего ожидания.
- Тесты: английские имена `Method_Scenario_Expected`, `ServerFactory` и `FakeEmailSender` вынесены в отдельные файлы.
