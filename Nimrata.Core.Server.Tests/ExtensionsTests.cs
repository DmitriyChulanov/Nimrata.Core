using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Controllers.Responses;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Подключения расширений, скрытие данных отключённых расширений, singleton и тип записи журнала
/// </summary>
public sealed class ExtensionsTests(ServerFactory factory) : IClassFixture<ServerFactory>, IAsyncLifetime
{
    private const string Alpha = """
        {
          "extension": "alpha", "version": 1,
          "name": "Альфа", "description": "Первое расширение", "icon": "list-checks", "defaultEnabled": true,
          "commands": [
            { "id": "alphaRun", "name": "Запустить", "icon": "star" },
            { "id": "alphaAsk", "name": "Спросить", "icon": "star", "description": "С параметром",
              "parameters": [ { "id": "days", "name": "Дней", "kind": "integer", "required": true } ] }
          ],
          "types": [
            { "id": "AlphaGroup", "name": "Группа", "allowedChildren": ["AlphaRoot", "AlphaItem", "AlphaGroup"] },
            { "id": "AlphaRoot", "name": "Корень", "singleton": true, "allowedChildren": ["AlphaItem"] },
            { "id": "AlphaItem", "name": "Элемент", "allowedChildren": [],
              "properties": [ { "id": "title", "name": "Название", "kind": "string" } ] }
          ]
        }
        """;

    private const string Beta = """
        {
          "extension": "beta", "version": 1,
          "name": "Бета", "description": "Второе расширение", "icon": "notebook", "defaultEnabled": true,
          "types": [
            { "id": "BetaItem", "name": "Элемент беты", "allowedChildren": [],
              "properties": [ { "id": "title", "name": "Название", "kind": "string" } ] }
          ]
        }
        """;

    private const string Gamma = """
        {
          "extension": "gamma", "version": 1,
          "name": "Гамма", "description": "Выключено по умолчанию", "icon": "star", "defaultEnabled": false,
          "types": [
            { "id": "GammaItem", "name": "Элемент гаммы", "allowedChildren": [] }
          ]
        }
        """;

    private const string ForeignEmail = "extensions-other@example.test";
    private const string ForeignPassword = "other-password-1";

    private string _directory = null!;
    private string _database = null!;
    private WebApplicationFactory<Program> _server = null!;
    private HttpClient _me = null!;
    private HttpClient _other = null!;

    /// <summary>
    /// Поднимает сервер с тремя расширениями и платформенным типом, создаёт двух пользователей
    /// </summary>
    /// <returns>Задача подготовки</returns>
    public async Task InitializeAsync()
    {
        _directory = Path.Combine(Path.GetTempPath(), "nimrata-extensions-" + Guid.NewGuid().ToString("N"));
        foreach (var (id, manifest) in new[] { ("alpha", Alpha), ("beta", Beta), ("gamma", Gamma) })
        {
            Directory.CreateDirectory(Path.Combine(_directory, id));
            await File.WriteAllTextAsync(Path.Combine(_directory, id, "manifest.json"), manifest);
        }
        _database = new NpgsqlConnectionStringBuilder(factory.ConnectionString)
            { Database = "e" + Guid.NewGuid().ToString("N"), Pooling = false }.ConnectionString;
        _server = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = _database,
                ["Extensions:Path"] = _directory,
            })));
        _me = await Login(ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        await _server.Services.GetRequiredService<AuthService>().CreateUserAsync(ForeignEmail, ForeignPassword, false);
        _other = await Login(ForeignEmail, ForeignPassword);

        // Платформенный тип: у него нет расширения; допускается как потомок корня alpha
        await using var connection = new NpgsqlConnection(_database);
        await connection.ExecuteAsync(
            """
            insert into types (id, extension_id, extension_version, definition)
            values ('PlatformItem', null, 1,
                    '{ "id": "PlatformItem", "name": "Платформенный", "properties": [ { "id": "title", "name": "Название", "kind": "string" } ] }'::jsonb);
            update types set definition = jsonb_set(definition, '{allowedChildren}', '["AlphaItem", "PlatformItem"]'::jsonb)
            where id = 'AlphaRoot';
            """);
    }

    /// <summary>
    /// Освобождает ресурсы теста
    /// </summary>
    /// <returns>Завершённая задача</returns>
    public Task DisposeAsync()
    {
        _me?.Dispose();
        _other?.Dispose();
        _server?.Dispose();
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
        return Task.CompletedTask;
    }

    /// <summary>
    /// Входит под пользователем
    /// </summary>
    /// <param name="email">Адрес</param>
    /// <param name="password">Пароль</param>
    /// <returns>Клиент с access-токеном</returns>
    private async Task<HttpClient> Login(string email, string password)
    {
        var client = _server.CreateClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password });
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>
    /// Описывает операцию создания объекта
    /// </summary>
    private static object Create(Guid id, string type, Guid? parent = null, double order = 1, object? properties = null) =>
        new { op = "create", id, type, parent, order, properties = properties ?? new { } };

    /// <summary>
    /// Отправляет набор изменений
    /// </summary>
    private static Task<HttpResponseMessage> Apply(HttpClient client, params object[] operations) =>
        client.PostAsJsonAsync("/api/changesets", new { operations });

    /// <summary>
    /// Применяет набор и проверяет успех
    /// </summary>
    private static async Task ApplyOk(HttpClient client, params object[] operations)
    {
        var response = await Apply(client, operations);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// Включает или выключает расширение для пользователя
    /// </summary>
    private static async Task Connect(HttpClient client, string extension, bool connected)
    {
        var response = await client.PutAsJsonAsync($"/api/extensions/{extension}/connection", new { connected });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// Идентификаторы загруженных объектов
    /// </summary>
    private static async Task<Guid[]> LoadIds(HttpClient client) =>
        (await client.GetFromJsonAsync<JsonElement[]>("/api/objects"))!
            .Select(o => o.GetProperty("id").GetGuid()).ToArray();

    /// <summary>
    /// Страница журнала
    /// </summary>
    private static async Task<JsonElement> Journal(HttpClient client, string request = "") =>
        await client.GetFromJsonAsync<JsonElement>("/api/journal" + request);

    /// <summary>
    /// Идентификаторы объектов записей журнала по порядку
    /// </summary>
    private static Guid[] JournalObjects(JsonElement page) =>
        page.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("objectId").GetGuid()).ToArray();

    /// <summary>
    /// Проверяет отказ с кодом статуса, фрагментом причины и стабильным кодом
    /// </summary>
    private static async Task AssertRejected(
        HttpResponseMessage response, HttpStatusCode status, string substring, string code)
    {
        Assert.Equal(status, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(substring, body.GetProperty("detail").GetString());
        Assert.Equal(code, body.GetProperty("code").GetString());
    }

    /// <summary>
    /// Запрос SQL к базе теста
    /// </summary>
    private async Task<T> Scalar<T>(string sql, object? parameters = null)
    {
        await using var connection = new NpgsqlConnection(_database);
        return (await connection.ExecuteScalarAsync<T>(sql, parameters))!;
    }

    /// <summary>
    /// Выполняет команду SQL в базе теста
    /// </summary>
    private async Task Exec(string sql, object? parameters = null)
    {
        await using var connection = new NpgsqlConnection(_database);
        await connection.ExecuteAsync(sql, parameters);
    }

    // --- Каталог и подключения ---

    /// <summary>
    /// Проверяет, что каталог отдаёт команды расширения из манифеста, а у расширения без команд список пуст
    /// </summary>
    [Fact]
    public async Task Catalog_ExtensionWithCommands_ReturnsThem()
    {
        var catalog = (await _me.GetFromJsonAsync<JsonElement[]>("/api/extensions"))!;

        var alpha = catalog.Single(e => e.GetProperty("id").GetString() == "alpha");
        var commands = alpha.GetProperty("commands").EnumerateArray().ToArray();
        Assert.Equal(["alphaRun", "alphaAsk"], commands.Select(c => c.GetProperty("id").GetString()).ToArray());
        Assert.Equal("Спросить", commands[1].GetProperty("name").GetString());
        Assert.Equal("days", commands[1].GetProperty("parameters")[0].GetProperty("id").GetString());
        var beta = catalog.Single(e => e.GetProperty("id").GetString() == "beta");
        Assert.Empty(beta.GetProperty("commands").EnumerateArray());
    }

    /// <summary>
    /// Проверяет, что платформенный тип «Пользовательская команда» скрыт в дереве, не принадлежит расширению
    /// и создаётся при любых подключениях
    /// </summary>
    [Fact]
    public async Task CustomCommandType_IsPlatformHiddenAndCreatableWithExtensionsDisabled()
    {
        var types = (await _me.GetFromJsonAsync<JsonElement[]>("/api/types"))!;
        var type = types.Single(t => t.GetProperty("id").GetString() == "CustomCommand");
        Assert.True(type.GetProperty("hiddenInTree").GetBoolean());
        Assert.Equal(JsonValueKind.Null, type.GetProperty("extension").ValueKind);
        Assert.Equal(["name", "extension", "command", "params"],
            type.GetProperty("properties").EnumerateArray().Select(p => p.GetProperty("id").GetString()).ToArray());
        foreach (var id in new[] { "alpha", "beta" })
            (await _me.PutAsJsonAsync($"/api/extensions/{id}/connection", new { connected = false })).EnsureSuccessStatusCode();

        var response = await Apply(_me, Create(Guid.CreateVersion7(), "CustomCommand", properties: new
        {
            name = "Открыть X", extension = "alpha", command = "alphaRun", @params = "{}",
        }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// Проверяет, что каталог расширений закрыт без токена
    /// </summary>
    [Fact]
    public async Task Catalog_WithoutToken_Returns401()
    {
        using var client = _server.CreateClient();

        var response = await client.GetAsync("/api/extensions");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// Проверяет, что каталог берётся из манифестов и состояние без записи определяется defaultEnabled
    /// </summary>
    [Fact]
    public async Task Catalog_NoConnectionRecords_UsesDefaultEnabledAndManifestMetadata()
    {
        var catalog = (await _me.GetFromJsonAsync<JsonElement[]>("/api/extensions"))!;

        Assert.Equal(["alpha", "beta", "gamma"], catalog.Select(e => e.GetProperty("id").GetString()).Order().ToArray());
        var alpha = catalog.Single(e => e.GetProperty("id").GetString() == "alpha");
        Assert.Equal("Альфа", alpha.GetProperty("name").GetString());
        Assert.Equal("Первое расширение", alpha.GetProperty("description").GetString());
        Assert.Equal("list-checks", alpha.GetProperty("icon").GetString());
        Assert.True(alpha.GetProperty("defaultEnabled").GetBoolean());
        Assert.True(alpha.GetProperty("connected").GetBoolean());
        var gamma = catalog.Single(e => e.GetProperty("id").GetString() == "gamma");
        Assert.False(gamma.GetProperty("defaultEnabled").GetBoolean());
        Assert.False(gamma.GetProperty("connected").GetBoolean());
    }

    /// <summary>
    /// Проверяет, что подключение меняет состояние только вошедшего пользователя и возвращается в каталоге
    /// </summary>
    [Fact]
    public async Task Connection_Put_ChangesOnlyOwnState()
    {
        await Connect(_me, "alpha", false);
        await Connect(_me, "gamma", true);

        var mine = (await _me.GetFromJsonAsync<JsonElement[]>("/api/extensions"))!;
        var theirs = (await _other.GetFromJsonAsync<JsonElement[]>("/api/extensions"))!;

        Assert.False(mine.Single(e => e.GetProperty("id").GetString() == "alpha").GetProperty("connected").GetBoolean());
        Assert.True(mine.Single(e => e.GetProperty("id").GetString() == "gamma").GetProperty("connected").GetBoolean());
        Assert.True(theirs.Single(e => e.GetProperty("id").GetString() == "alpha").GetProperty("connected").GetBoolean());
        Assert.False(theirs.Single(e => e.GetProperty("id").GetString() == "gamma").GetProperty("connected").GetBoolean());
    }

    /// <summary>
    /// Проверяет, что повторное переключение обновляет запись, а ответ возвращает элемент каталога
    /// </summary>
    [Fact]
    public async Task Connection_PutTwice_UpdatesSingleRecordAndReturnsCatalogItem()
    {
        await Connect(_me, "beta", false);
        var response = await _me.PutAsJsonAsync("/api/extensions/beta/connection", new { connected = true });

        var item = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("beta", item.GetProperty("id").GetString());
        Assert.True(item.GetProperty("connected").GetBoolean());
        Assert.Equal(1, await Scalar<long>("select count(*) from user_extensions where extension_id = 'beta'"));
    }

    /// <summary>
    /// Проверяет, что неизвестное расширение даёт 404 и запись не создаётся
    /// </summary>
    [Fact]
    public async Task Connection_PutUnknownExtension_Returns404()
    {
        var response = await _me.PutAsJsonAsync("/api/extensions/nope/connection", new { connected = true });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(0, await Scalar<long>("select count(*) from user_extensions"));
    }

    /// <summary>
    /// Проверяет, что тело без connected отклоняется
    /// </summary>
    [Fact]
    public async Task Connection_PutWithoutConnected_Returns400()
    {
        var response = await _me.PutAsJsonAsync("/api/extensions/alpha/connection", new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// Проверяет, что подключения удаляются вместе с пользователем
    /// </summary>
    [Fact]
    public async Task Connection_UserDeleted_RecordsAreCascaded()
    {
        await Connect(_other, "alpha", false);
        Assert.Equal(1, await Scalar<long>("select count(*) from user_extensions"));

        await Exec("delete from users where email = @email", new { email = ForeignEmail });

        Assert.Equal(0, await Scalar<long>("select count(*) from user_extensions"));
    }

    // --- Скрытие объектов ---

    /// <summary>
    /// Проверяет, что объекты отключённого расширения не читаются, платформенные видны всегда, данные возвращаются
    /// </summary>
    [Fact]
    public async Task Objects_DisabledExtension_HiddenAndReturnedAfterReconnect()
    {
        Guid alphaItem = Guid.CreateVersion7(), betaItem = Guid.CreateVersion7(), platform = Guid.CreateVersion7();
        await ApplyOk(_me,
            Create(alphaItem, "AlphaItem"), Create(betaItem, "BetaItem"), Create(platform, "PlatformItem"));
        Assert.Equivalent(new[] { alphaItem, betaItem, platform }, await LoadIds(_me));

        await Connect(_me, "alpha", false);

        Assert.Equivalent(new[] { betaItem, platform }, await LoadIds(_me));
        await Connect(_me, "alpha", true);
        Assert.Equivalent(new[] { alphaItem, betaItem, platform }, await LoadIds(_me));
    }

    /// <summary>
    /// Проверяет, что объекты расширения, выключенного по умолчанию, скрыты до подключения
    /// </summary>
    [Fact]
    public async Task Objects_ExtensionDisabledByDefault_HiddenUntilConnected()
    {
        var gammaItem = Guid.CreateVersion7();
        await Exec(
            "insert into objects (id, type_id, owner_id) select @gammaItem, 'GammaItem', id from users where email = @email",
            new { gammaItem, email = ServerFactory.AdminEmail });

        Assert.Empty(await LoadIds(_me));
        await Connect(_me, "gamma", true);
        Assert.Equal([gammaItem], await LoadIds(_me));
    }

    /// <summary>
    /// Проверяет, что отключение действует только на самого пользователя
    /// </summary>
    [Fact]
    public async Task Objects_DisabledForOneUser_StillVisibleForOthers()
    {
        var mine = Guid.CreateVersion7();
        var theirs = Guid.CreateVersion7();
        await ApplyOk(_me, Create(mine, "BetaItem"));
        await ApplyOk(_other, Create(theirs, "BetaItem"));

        await Connect(_me, "beta", false);

        Assert.Empty(await LoadIds(_me));
        Assert.Equal([theirs], await LoadIds(_other));
    }

    // --- Запись в отключённое расширение ---

    /// <summary>
    /// Проверяет, что создание объекта отключённого расширения отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_CreateInDisabledExtension_IsRejected()
    {
        await Connect(_me, "beta", false);

        var response = await Apply(_me, Create(Guid.CreateVersion7(), "BetaItem"));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "Расширение отключено", "extension_disabled");
    }

    /// <summary>
    /// Проверяет, что изменение, перемещение и удаление объекта отключённого расширения отклоняются
    /// </summary>
    [Fact]
    public async Task Changeset_UpdateMoveDeleteInDisabledExtension_AreRejected()
    {
        Guid group = Guid.CreateVersion7(), item = Guid.CreateVersion7();
        await ApplyOk(_me, Create(group, "AlphaGroup"), Create(item, "AlphaItem", group));
        await Connect(_me, "alpha", false);

        var update = await Apply(_me,
            new { op = "update", id = item, changes = new { title = new { old = (string?)null, @new = "x" } } });
        var move = await Apply(_me, new { op = "move", id = item, order = new { old = 1, @new = 2 } });
        var delete = await Apply(_me, new { op = "delete", id = item });

        await AssertRejected(update, HttpStatusCode.UnprocessableEntity, "Расширение отключено", "extension_disabled");
        await AssertRejected(move, HttpStatusCode.UnprocessableEntity, "Расширение отключено", "extension_disabled");
        await AssertRejected(delete, HttpStatusCode.UnprocessableEntity, "Расширение отключено", "extension_disabled");
        await Connect(_me, "alpha", true);
        Assert.Contains(item, await LoadIds(_me));
    }

    /// <summary>
    /// Проверяет, что создание платформенного объекта под родителем скрытого типа отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_CreateUnderParentOfDisabledExtension_IsRejected()
    {
        var root = Guid.CreateVersion7();
        await ApplyOk(_me, Create(root, "AlphaRoot"));
        await Connect(_me, "alpha", false);

        var response = await Apply(_me, Create(Guid.CreateVersion7(), "PlatformItem", root));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "Расширение отключено", "extension_disabled");
    }

    /// <summary>
    /// Проверяет, что перемещение платформенного объекта под родителя скрытого типа отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_MoveUnderParentOfDisabledExtension_IsRejected()
    {
        Guid root = Guid.CreateVersion7(), platform = Guid.CreateVersion7();
        await ApplyOk(_me, Create(root, "AlphaRoot"), Create(platform, "PlatformItem"));
        await Connect(_me, "alpha", false);

        var response = await Apply(_me,
            new { op = "move", id = platform, parent = new { old = (Guid?)null, @new = root } });

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "Расширение отключено", "extension_disabled");
    }

    /// <summary>
    /// Проверяет, что платформенные объекты изменяются при любых подключениях
    /// </summary>
    [Fact]
    public async Task Changeset_PlatformTypeWithAllExtensionsDisabled_IsAccepted()
    {
        foreach (var extension in new[] { "alpha", "beta" }) await Connect(_me, extension, false);

        var response = await Apply(_me, Create(Guid.CreateVersion7(), "PlatformItem"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// Проверяет, что набор, затрагивающий два расширения, принимается целиком при обоих подключённых
    /// </summary>
    [Fact]
    public async Task Changeset_TouchingTwoExtensions_AppliedWhenBothEnabled()
    {
        Guid a = Guid.CreateVersion7(), b = Guid.CreateVersion7();

        var response = await Apply(_me, Create(a, "AlphaItem"), Create(b, "BetaItem"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equivalent(new[] { a, b }, await LoadIds(_me));
    }

    /// <summary>
    /// Проверяет, что набор, затрагивающий два расширения, при одном отключённом отклоняется целиком
    /// </summary>
    [Fact]
    public async Task Changeset_TouchingTwoExtensions_RejectedAsWholeWhenOneDisabled()
    {
        Guid a = Guid.CreateVersion7(), b = Guid.CreateVersion7();
        await Connect(_me, "beta", false);

        var response = await Apply(_me, Create(a, "AlphaItem"), Create(b, "BetaItem"));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "Операция 2: Расширение отключено", "extension_disabled");
        Assert.Empty(await LoadIds(_me));
        Assert.Equal(0, await Scalar<long>("select count(*) from changesets"));
    }

    // --- singleton ---

    /// <summary>
    /// Проверяет, что второй singleton у того же родителя отклоняется со стабильным кодом
    /// </summary>
    [Fact]
    public async Task Changeset_SecondSingletonUnderSameParent_IsRejectedWithSingletonCode()
    {
        var group = Guid.CreateVersion7();
        await ApplyOk(_me, Create(group, "AlphaGroup"), Create(Guid.CreateVersion7(), "AlphaRoot", group));

        var response = await Apply(_me, Create(Guid.CreateVersion7(), "AlphaRoot", group));

        await AssertRejected(response, HttpStatusCode.Conflict, "уже есть", "singleton_exists");
    }

    /// <summary>
    /// Проверяет, что второй singleton среди корневых объектов отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_SecondSingletonAtRoot_IsRejected()
    {
        await ApplyOk(_me, Create(Guid.CreateVersion7(), "AlphaRoot"));

        var response = await Apply(_me, Create(Guid.CreateVersion7(), "AlphaRoot"));

        await AssertRejected(response, HttpStatusCode.Conflict, "уже есть", "singleton_exists");
    }

    /// <summary>
    /// Проверяет, что два singleton в одном наборе отклоняются
    /// </summary>
    [Fact]
    public async Task Changeset_TwoSingletonsInOneChangeset_IsRejected()
    {
        var response = await Apply(_me,
            Create(Guid.CreateVersion7(), "AlphaRoot"), Create(Guid.CreateVersion7(), "AlphaRoot"));

        await AssertRejected(response, HttpStatusCode.Conflict, "Операция 2", "singleton_exists");
        Assert.Empty(await LoadIds(_me));
    }

    /// <summary>
    /// Проверяет, что перемещение singleton под родителя, где такой объект уже есть, отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_MoveSingletonUnderParentWithSame_IsRejectedWithSingletonCode()
    {
        Guid group = Guid.CreateVersion7(), movable = Guid.CreateVersion7();
        await ApplyOk(_me, Create(group, "AlphaGroup"), Create(Guid.CreateVersion7(), "AlphaRoot", group),
            Create(movable, "AlphaRoot", null, order: 2));

        var response = await Apply(_me, new { op = "move", id = movable, parent = new { old = (Guid?)null, @new = group } });

        await AssertRejected(response, HttpStatusCode.Conflict, "уже есть", "singleton_exists");
        Assert.Equal(0, await Scalar<long>(
            "select count(*) from objects where id = @movable and parent_id is not null", new { movable }));
    }

    /// <summary>
    /// Проверяет, что singleton можно переместить под родителя без такого объекта и менять его порядок
    /// </summary>
    [Fact]
    public async Task Changeset_MoveSingletonToFreeParentOrChangeOrder_IsAccepted()
    {
        Guid group = Guid.CreateVersion7(), root = Guid.CreateVersion7();
        await ApplyOk(_me, Create(group, "AlphaGroup"), Create(root, "AlphaRoot", null, order: 1));

        var toGroup = await Apply(_me, new { op = "move", id = root, parent = new { old = (Guid?)null, @new = group } });
        var reorder = await Apply(_me, new { op = "move", id = root, order = new { old = 1, @new = 5 } });

        Assert.Equal(HttpStatusCode.OK, toGroup.StatusCode);
        Assert.Equal(HttpStatusCode.OK, reorder.StatusCode);
    }

    /// <summary>
    /// Проверяет, что singleton допускается у другого родителя и у другого владельца
    /// </summary>
    [Fact]
    public async Task Changeset_SingletonUnderOtherParentOrOwner_IsAccepted()
    {
        Guid group = Guid.CreateVersion7(), otherGroup = Guid.CreateVersion7();
        await ApplyOk(_me, Create(group, "AlphaGroup"), Create(otherGroup, "AlphaGroup"),
            Create(Guid.CreateVersion7(), "AlphaRoot", group));

        var otherParent = await Apply(_me, Create(Guid.CreateVersion7(), "AlphaRoot", otherGroup));
        var otherOwner = await Apply(_other, Create(Guid.CreateVersion7(), "AlphaRoot", null));

        Assert.Equal(HttpStatusCode.OK, otherParent.StatusCode);
        Assert.Equal(HttpStatusCode.OK, otherOwner.StatusCode);
    }

    /// <summary>
    /// Проверяет, что не-singleton тип создаётся повторно без ограничений
    /// </summary>
    [Fact]
    public async Task Changeset_SecondObjectOfOrdinaryType_IsAccepted()
    {
        await ApplyOk(_me, Create(Guid.CreateVersion7(), "AlphaItem"));

        var response = await Apply(_me, Create(Guid.CreateVersion7(), "AlphaItem"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// Проверяет, что код singleton отличает отказ от занятого идентификатора (тоже 409)
    /// </summary>
    [Fact]
    public async Task Changeset_DuplicateId_HasNoSingletonCode()
    {
        var id = Guid.CreateVersion7();
        await ApplyOk(_me, Create(id, "AlphaItem"));

        var response = await Apply(_me, Create(id, "AlphaItem"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.TryGetProperty("code", out var code) && code.ValueKind == JsonValueKind.String
            && code.GetString() == "singleton_exists");
    }

    /// <summary>
    /// Проверяет, что манифест передаёт singleton в определение типа
    /// </summary>
    [Fact]
    public async Task Types_Singleton_IsExposedInDefinition()
    {
        var types = (await _me.GetFromJsonAsync<JsonElement[]>("/api/types"))!;

        var root = types.Single(t => t.GetProperty("id").GetString() == "AlphaRoot");
        Assert.True(root.GetProperty("singleton").GetBoolean());
    }

    // --- Журнал ---

    /// <summary>
    /// Проверяет, что ChangesetService пишет тип объекта во все записи журнала
    /// </summary>
    [Fact]
    public async Task Journal_Entries_StoreObjectTypeForAllOperations()
    {
        Guid item = Guid.CreateVersion7(), group = Guid.CreateVersion7();
        await ApplyOk(_me, Create(group, "AlphaGroup"), Create(item, "AlphaItem"));
        await ApplyOk(_me, new { op = "update", id = item, changes = new { title = new { old = (string?)null, @new = "x" } } });
        await ApplyOk(_me, new { op = "move", id = item, parent = new { old = (Guid?)null, @new = group } });
        await ApplyOk(_me, new { op = "delete", id = item });

        await using var connection = new NpgsqlConnection(_database);
        var rows = (await connection.QueryAsync<(Guid ObjectId, string Operation, string? TypeId)>(
            "select object_id, operation, type_id from changeset_entries")).ToList();

        Assert.Equal(5, rows.Count);
        Assert.All(rows.Where(r => r.ObjectId == item), r => Assert.Equal("AlphaItem", r.TypeId));
        Assert.All(rows.Where(r => r.ObjectId == group), r => Assert.Equal("AlphaGroup", r.TypeId));
    }

    /// <summary>
    /// Проверяет, что журнал скрывает записи отключённых расширений и возвращает их после подключения
    /// </summary>
    [Fact]
    public async Task Journal_DisabledExtension_EntriesHiddenAndReturnedAfterReconnect()
    {
        Guid a = Guid.CreateVersion7(), b = Guid.CreateVersion7(), p = Guid.CreateVersion7();
        await ApplyOk(_me, Create(a, "AlphaItem"), Create(b, "BetaItem"), Create(p, "PlatformItem"));

        await Connect(_me, "alpha", false);
        var hidden = await Journal(_me);
        await Connect(_me, "alpha", true);
        var shown = await Journal(_me);

        Assert.Equivalent(new[] { b, p }, JournalObjects(hidden));
        Assert.Equal(2, hidden.GetProperty("total").GetInt32());
        Assert.Equivalent(new[] { a, b, p }, JournalObjects(shown));
        Assert.Equal(3, shown.GetProperty("total").GetInt32());
    }

    /// <summary>
    /// Проверяет, что журнал по скрытому объекту пуст
    /// </summary>
    [Fact]
    public async Task Journal_ByObjectOfDisabledExtension_IsEmpty()
    {
        var a = Guid.CreateVersion7();
        await ApplyOk(_me, Create(a, "AlphaItem"));
        await Connect(_me, "alpha", false);

        var page = await Journal(_me, $"?objectId={a}");

        Assert.Empty(page.GetProperty("items").EnumerateArray());
        Assert.Equal(0, page.GetProperty("total").GetInt32());
    }

    /// <summary>
    /// Проверяет, что записи с неопределённым типом видны всегда
    /// </summary>
    [Fact]
    public async Task Journal_EntryWithUnknownType_IsAlwaysVisible()
    {
        var a = Guid.CreateVersion7();
        await ApplyOk(_me, Create(a, "AlphaItem"));
        await Connect(_me, "alpha", false);
        await Exec("alter table changeset_entries disable trigger trg_changeset_entries_immutable; " +
                   "update changeset_entries set type_id = null; " +
                   "alter table changeset_entries enable trigger trg_changeset_entries_immutable");

        var page = await Journal(_me);

        Assert.Equal([a], JournalObjects(page));
    }

    /// <summary>
    /// Проверяет, что пагинация и total согласованы с фильтром скрытия
    /// </summary>
    [Fact]
    public async Task Journal_Pagination_ConsistentWithHiding()
    {
        var alphaIds = Enumerable.Range(0, 3).Select(_ => Guid.CreateVersion7()).ToArray();
        var betaIds = Enumerable.Range(0, 4).Select(_ => Guid.CreateVersion7()).ToArray();
        var operations = new List<object>();
        for (var i = 0; i < 3; i++)
        {
            operations.Add(Create(alphaIds[i], "AlphaItem"));
            operations.Add(Create(betaIds[i], "BetaItem"));
        }
        operations.Add(Create(betaIds[3], "BetaItem"));
        await ApplyOk(_me, [.. operations]);
        await Connect(_me, "alpha", false);

        var first = await Journal(_me, "?skip=0&take=3");
        var second = await Journal(_me, "?skip=3&take=3");

        Assert.Equal(4, first.GetProperty("total").GetInt32());
        Assert.Equal(3, JournalObjects(first).Length);
        Assert.Equal(1, JournalObjects(second).Length);
        Assert.Equivalent(betaIds, JournalObjects(first).Concat(JournalObjects(second)).ToArray());
    }
}
