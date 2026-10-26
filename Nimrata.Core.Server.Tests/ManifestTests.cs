using Nimrata.Core.Server.Controllers.Responses;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Манифест расширения: загрузка в таблицу типов при старте и выдача типов по API
/// </summary>
public sealed class ManifestTests(ServerFactory factory) : IClassFixture<ServerFactory>, IDisposable
{
    private readonly List<string> _directories = [];

    /// <summary>
    /// Удаляет временные каталоги и базы теста
    /// </summary>
    public void Dispose()
    {
        foreach (var directory in _directories) Directory.Delete(directory, recursive: true);
    }

    /// <summary>
    /// Формирует JSON описания типа
    /// </summary>
    /// <param name="id">Идентификатор типа</param>
    /// <param name="name">Название</param>
    /// <returns>JSON типа</returns>
    private static string TypeJson(string id, string name = "Тип") =>
        $$"""{ "id": "{{id}}", "name": "{{name}}" }""";

    /// <summary>
    /// Формирует JSON манифеста
    /// </summary>
    /// <param name="version">Версия манифеста</param>
    /// <param name="types">JSON типов</param>
    /// <returns>JSON манифеста</returns>
    private static string Manifest(int version, params string[] types) =>
        $$"""{ "extension": "demo", "version": {{version}}, "name": "Демо", "description": "Тестовое расширение", "icon": "star", "defaultEnabled": true, "types": [ {{string.Join(",", types)}} ] }""";

    /// <summary>
    /// Каталог расширений с одним манифестом
    /// </summary>
    private string ExtensionsDirectory(string manifest)
    {
        var directory = Path.Combine(Path.GetTempPath(), "nimrata-extensions-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(directory, "demo"));
        File.WriteAllText(Path.Combine(directory, "demo", "manifest.json"), manifest);
        _directories.Add(directory);
        return directory;
    }

    /// <summary>
    /// Создаёт отдельную пустую базу для теста
    /// </summary>
    /// <param name="row">Строка подключения, из которой берётся сервер</param>
    /// <returns>Строка подключения к новой базе</returns>
    private static string NewDatabase(string row) =>
        new NpgsqlConnectionStringBuilder(row) { Database = "m" + Guid.NewGuid().ToString("N") }.ConnectionString;

    /// <summary>
    /// Запускает сервер с отдельной базой и каталогом расширений
    /// </summary>
    /// <param name="database">Строка подключения</param>
    /// <param name="directory">Каталог манифестов или null</param>
    /// <returns>Фабрика сервера</returns>
    private WebApplicationFactory<Program> Server(string database, string? directory) =>
        factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, configuration) =>
        {
            var values = new Dictionary<string, string?> { ["ConnectionStrings:Default"] = database };
            if (directory is not null) values["Extensions:Path"] = directory;
            configuration.AddInMemoryCollection(values);
        }));

    /// <summary>
    /// Запрашивает типы у API
    /// </summary>
    /// <param name="client">Клиент HTTP</param>
    /// <returns>Массив типов</returns>
    private static async Task<JsonElement[]> FetchTypes(HttpClient client)
    {
        var login = await client.PostAsJsonAsync("/api/auth/login",
            new { email = ServerFactory.AdminEmail, password = ServerFactory.AdminPassword });
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (await client.GetFromJsonAsync<JsonElement[]>("/api/types"))!;
    }

    /// <summary>
    /// Считает строки таблицы типов
    /// </summary>
    /// <param name="database">Строка подключения</param>
    /// <returns>Число строк</returns>
    private static async Task<long> RowCount(string database)
    {
        await using var connection = new NpgsqlConnection(database);
        return await connection.ExecuteScalarAsync<long>("select count(*) from types");
    }

    /// <summary>
    /// Читает идентификатор типа
    /// </summary>
    /// <param name="type">JSON типа</param>
    /// <returns>Идентификатор</returns>
    private static string GetId(JsonElement type) => type.GetProperty("id").GetString()!;

    /// <summary>
    /// Проверяет, что без токена типы недоступны
    /// </summary>
    [Fact]
    public async Task Types_WithoutToken_Returns401()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/types");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// Проверяет, что манифест Трекера заметок по умолчанию даёт типы заметки и группы заметок
    /// </summary>
    [Fact]
    public async Task Types_DefaultManifests_ReturnNoteAndNoteGroupFromNotes()
    {
        using var client = factory.CreateClient();

        var types = await FetchTypes(client);

        var ids = types.Select(GetId).ToList();
        Assert.Contains("Note", ids);
        Assert.Contains("NoteGroup", ids);
        var note = types.Single(type => GetId(type) == "Note");
        Assert.Equal("notes", note.GetProperty("extension").GetString());
        Assert.Contains(note.GetProperty("properties").EnumerateArray(),
            property => property.GetProperty("id").GetString() == "priority" && property.GetProperty("kind").GetString() == "enum");
    }

    /// <summary>
    /// Проверяет, что при старте типы загружаются из манифеста
    /// </summary>
    [Fact]
    public async Task Startup_LoadsTypesFromManifest()
    {
        var database = NewDatabase(factory.ConnectionString);
        using var server = Server(database, ExtensionsDirectory(Manifest(1, TypeJson("A", "Первый"), TypeJson("B"))));
        using var client = server.CreateClient();

        var types = await FetchTypes(client);

        Assert.Equal(["A", "B"], types.Select(GetId).Order());
        var a = types.Single(type => GetId(type) == "A");
        Assert.Equal("Первый", a.GetProperty("name").GetString());
        Assert.Equal(1, a.GetProperty("extensionVersion").GetInt32());
    }

    /// <summary>
    /// Проверяет, что повторный запуск той же версии не дублирует типы
    /// </summary>
    [Fact]
    public async Task Restart_SameVersion_DoesNotDuplicateTypes()
    {
        var database = NewDatabase(factory.ConnectionString);
        var directory = ExtensionsDirectory(Manifest(1, TypeJson("A"), TypeJson("B")));
        using (var first = Server(database, directory))
        {
            using var serverClient = first.CreateClient();
            await FetchTypes(serverClient);
        }

        using var second = Server(database, directory);
        using var client = second.CreateClient();
        var types = await FetchTypes(client);

        Assert.Equal(2, types.Length);
        Assert.Equal(2, await RowCount(database));
    }

    /// <summary>
    /// Проверяет, что новая версия манифеста обновляет типы и добавляет новые
    /// </summary>
    [Fact]
    public async Task Startup_NewManifestVersion_UpdatesTypesAndAddsNew()
    {
        var database = NewDatabase(factory.ConnectionString);
        var directory = ExtensionsDirectory(Manifest(1, TypeJson("A", "Старое имя")));
        using (var first = Server(database, directory))
        {
            using var serverClient = first.CreateClient();
            await FetchTypes(serverClient);
        }
        File.WriteAllText(Path.Combine(directory, "demo", "manifest.json"),
            Manifest(2, TypeJson("A", "Новое имя"), TypeJson("C")));

        using var second = Server(database, directory);
        using var client = second.CreateClient();
        var types = await FetchTypes(client);

        Assert.Equal(2, types.Length);
        var a = types.Single(type => GetId(type) == "A");
        Assert.Equal("Новое имя", a.GetProperty("name").GetString());
        Assert.Equal(2, a.GetProperty("extensionVersion").GetInt32());
    }

    /// <summary>
    /// Проверяет, что та же версия с другим содержимым типы не перезаписывает
    /// </summary>
    [Fact]
    public async Task Startup_SameVersionDifferentContent_DoesNotOverwriteTypes()
    {
        var database = NewDatabase(factory.ConnectionString);
        var directory = ExtensionsDirectory(Manifest(1, TypeJson("A", "Исходное")));
        using (var first = Server(database, directory))
        {
            using var serverClient = first.CreateClient();
            await FetchTypes(serverClient);
        }
        File.WriteAllText(Path.Combine(directory, "demo", "manifest.json"), Manifest(1, TypeJson("A", "Правка без версии")));

        using var second = Server(database, directory);
        using var client = second.CreateClient();
        var types = await FetchTypes(client);

        Assert.Equal("Исходное", types.Single().GetProperty("name").GetString());
    }

    /// <summary>
    /// Некорректные манифесты и ожидаемые фрагменты сообщений об ошибке
    /// </summary>
    public static TheoryData<string, string> InvalidManifests => new()
    {
        { "{ не json", "JSON" },
        { """{ "extension": "demo", "types": [] }""", "version" },
        { """{ "extension": "demo", "version": 1 }""", "types" },
        { Manifest(1, """{ "name": "Без id" }"""), "id" },
        { Manifest(1, TypeJson("A"), TypeJson("A")), "повторяется" },
        { Manifest(1, """{ "id": "A", "name": "A", "properties": [ { "id": "p", "name": "P", "kind": "float" } ] }"""), "float" },
        { Manifest(1, """{ "id": "A", "name": "A", "properties": [ { "id": "p", "name": "P", "kind": "enum" } ] }"""), "enum" },
        { Manifest(1, """{ "id": "A", "name": "A", "allowedChildren": ["Нет"] }"""), "Нет" },
        { Manifest(1, """{ "id": "A", "name": "A", "abstract": true, "sealed": true }"""), "abstract" },
        { Manifest(1, """{ "id": "A", "name": "A", "actions": [ { "id": "x", "name": "X", "placements": ["toolbar"] } ] }"""), "toolbar" },
        { Manifest(1, """{ "id": "A", "name": "A", "colorRules": [ { "property": "нет", "equals": "1", "color": "red" } ] }"""), "нет" },
    };

    /// <summary>
    /// Проверяет, что некорректный манифест останавливает запуск с понятной ошибкой
    /// </summary>
    /// <param name="manifest">JSON манифеста</param>
    /// <param name="substring">Фрагмент ожидаемого сообщения</param>
    [Theory]
    [MemberData(nameof(InvalidManifests))]
    public void Startup_InvalidManifest_FailsWithClearError(string manifest, string substring)
    {
        var database = NewDatabase(factory.ConnectionString);
        using var server = Server(database, ExtensionsDirectory(manifest));

        var error = Assert.ThrowsAny<Exception>(() => server.CreateClient());

        Assert.Contains(substring, error.ToString());
        Assert.Contains("manifest.json", error.ToString());
    }

    /// <summary>
    /// Проверяет, что тип одного расширения нельзя вложить в тип другого, и запуск останавливается
    /// </summary>
    [Fact]
    public void Startup_AllowedChildrenFromOtherExtension_FailsWithClearError()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nimrata-extensions-" + Guid.NewGuid().ToString("N"));
        _directories.Add(directory);
        Directory.CreateDirectory(Path.Combine(directory, "one"));
        Directory.CreateDirectory(Path.Combine(directory, "two"));
        const string metadata = """ "name": "Расширение", "description": "Описание", "icon": "star", "defaultEnabled": true """;
        File.WriteAllText(Path.Combine(directory, "one", "manifest.json"),
            $$"""{ "extension": "one", "version": 1, {{metadata}}, "types": [ { "id": "A", "name": "A", "allowedChildren": ["B"] } ] }""");
        File.WriteAllText(Path.Combine(directory, "two", "manifest.json"),
            $$"""{ "extension": "two", "version": 1, {{metadata}}, "types": [ { "id": "B", "name": "B" } ] }""");
        using var server = Server(NewDatabase(factory.ConnectionString), directory);

        var error = Assert.ThrowsAny<Exception>(() => server.CreateClient());

        Assert.Contains("другому расширению", error.ToString());
        Assert.Contains("one", error.ToString());
    }

    /// <summary>
    /// Проверяет, что метаданные расширения обновляются вместе с новой версией манифеста
    /// </summary>
    [Fact]
    public async Task Startup_NewManifestVersion_UpdatesExtensionMetadata()
    {
        var database = NewDatabase(factory.ConnectionString);
        var directory = ExtensionsDirectory(Manifest(1, TypeJson("A")));
        using (var first = Server(database, directory))
        {
            using var serverClient = first.CreateClient();
            await FetchTypes(serverClient);
        }
        File.WriteAllText(Path.Combine(directory, "demo", "manifest.json"),
            Manifest(2, TypeJson("A")).Replace("\"Демо\"", "\"Новое название\""));

        using var second = Server(database, directory);
        using var client = second.CreateClient();
        await FetchTypes(client);

        await using var connection = new NpgsqlConnection(database);
        Assert.Equal("Новое название", await connection.ExecuteScalarAsync<string>("select name from extensions where id = 'demo'"));
        Assert.Equal(1, await connection.ExecuteScalarAsync<long>("select count(*) from extensions"));
    }

    /// <summary>
    /// Проверяет, что метаданные расширения обновляются из манифеста и при той же версии, а типы остаются прежними
    /// </summary>
    [Fact]
    public async Task Startup_SameVersionChangedMetadata_UpdatesMetadataButNotTypes()
    {
        var database = NewDatabase(factory.ConnectionString);
        var directory = ExtensionsDirectory(Manifest(1, TypeJson("A", "Исходное")));
        using (var first = Server(database, directory))
        {
            using var serverClient = first.CreateClient();
            await FetchTypes(serverClient);
        }
        File.WriteAllText(Path.Combine(directory, "demo", "manifest.json"),
            Manifest(1, TypeJson("A", "Правка без версии"))
                .Replace("\"Демо\"", "\"Новое название\"")
                .Replace("\"star\"", "\"list-checks\"")
                .Replace("\"defaultEnabled\": true", "\"defaultEnabled\": false"));

        using var second = Server(database, directory);
        using var client = second.CreateClient();
        var types = await FetchTypes(client);

        await using var connection = new NpgsqlConnection(database);
        var row = await connection.QuerySingleAsync<(string Name, string Icon, bool DefaultEnabled)>(
            "select name, icon, default_enabled from extensions where id = 'demo'");
        Assert.Equal(("Новое название", "list-checks", false), row);
        Assert.Equal("Исходное", types.Single().GetProperty("name").GetString());
    }
}
