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

/// <summary>Манифест модуля: загрузка в таблицу типов при старте и выдача типов по API</summary>
public sealed class ManifestTests(ServerFactory factory) : IClassFixture<ServerFactory>, IDisposable
{
    private readonly List<string> _directories = [];

    public void Dispose()
    {
        foreach (var directory in _directories) Directory.Delete(directory, recursive: true);
    }

    private static string TypeJson(string id, string name = "Тип") =>
        $$"""{ "id": "{{id}}", "name": "{{name}}" }""";

    private static string Manifest(int version, params string[] types) =>
        $$"""{ "module": "demo", "version": {{version}}, "types": [ {{string.Join(",", types)}} ] }""";

    /// <summary>Каталог модулей с одним манифестом</summary>
    private string ModulesDirectory(string manifest)
    {
        var directory = Path.Combine(Path.GetTempPath(), "nimrata-modules-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(directory, "demo"));
        File.WriteAllText(Path.Combine(directory, "demo", "manifest.json"), manifest);
        _directories.Add(directory);
        return directory;
    }

    private static string NewDatabase(string row) =>
        new NpgsqlConnectionStringBuilder(row) { Database = "m" + Guid.NewGuid().ToString("N") }.ConnectionString;

    private WebApplicationFactory<Program> Server(string database, string? directory) =>
        factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, configuration) =>
        {
            var values = new Dictionary<string, string?> { ["ConnectionStrings:Default"] = database };
            if (directory is not null) values["Modules:Path"] = directory;
            configuration.AddInMemoryCollection(values);
        }));

    private static async Task<JsonElement[]> FetchTypes(HttpClient client)
    {
        var login = await client.PostAsJsonAsync("/api/auth/login",
            new { email = ServerFactory.AdminEmail, password = ServerFactory.AdminPassword });
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (await client.GetFromJsonAsync<JsonElement[]>("/api/types"))!;
    }

    private static async Task<long> RowCount(string database)
    {
        await using var connection = new NpgsqlConnection(database);
        return await connection.ExecuteScalarAsync<long>("select count(*) from types");
    }

    private static string GetId(JsonElement type) => type.GetProperty("id").GetString()!;

    [Fact]
    public async Task Types_WithoutToken_Returns401()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/types");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Types_DefaultTrackerManifest_ReturnsNoteAndNoteGroup()
    {
        using var client = factory.CreateClient();

        var types = await FetchTypes(client);

        var ids = types.Select(GetId).ToList();
        Assert.Contains("Note", ids);
        Assert.Contains("NoteGroup", ids);
        var note = types.Single(type => GetId(type) == "Note");
        Assert.Equal("tracker", note.GetProperty("module").GetString());
        Assert.Contains(note.GetProperty("properties").EnumerateArray(),
            property => property.GetProperty("id").GetString() == "priority" && property.GetProperty("kind").GetString() == "enum");
    }

    [Fact]
    public async Task Startup_LoadsTypesFromManifest()
    {
        var database = NewDatabase(factory.ConnectionString);
        using var server = Server(database, ModulesDirectory(Manifest(1, TypeJson("A", "Первый"), TypeJson("B"))));
        using var client = server.CreateClient();

        var types = await FetchTypes(client);

        Assert.Equal(["A", "B"], types.Select(GetId).Order());
        var a = types.Single(type => GetId(type) == "A");
        Assert.Equal("Первый", a.GetProperty("name").GetString());
        Assert.Equal(1, a.GetProperty("moduleVersion").GetInt32());
    }

    [Fact]
    public async Task Restart_SameVersion_DoesNotDuplicateTypes()
    {
        var database = NewDatabase(factory.ConnectionString);
        var directory = ModulesDirectory(Manifest(1, TypeJson("A"), TypeJson("B")));
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

    [Fact]
    public async Task Startup_NewManifestVersion_UpdatesTypesAndAddsNew()
    {
        var database = NewDatabase(factory.ConnectionString);
        var directory = ModulesDirectory(Manifest(1, TypeJson("A", "Старое имя")));
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
        Assert.Equal(2, a.GetProperty("moduleVersion").GetInt32());
    }

    [Fact]
    public async Task Startup_SameVersionDifferentContent_DoesNotOverwriteTypes()
    {
        var database = NewDatabase(factory.ConnectionString);
        var directory = ModulesDirectory(Manifest(1, TypeJson("A", "Исходное")));
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

    public static TheoryData<string, string> InvalidManifests => new()
    {
        { "{ не json", "JSON" },
        { """{ "module": "demo", "types": [] }""", "version" },
        { """{ "module": "demo", "version": 1 }""", "types" },
        { Manifest(1, """{ "name": "Без id" }"""), "id" },
        { Manifest(1, TypeJson("A"), TypeJson("A")), "повторяется" },
        { Manifest(1, """{ "id": "A", "name": "A", "properties": [ { "id": "p", "name": "P", "kind": "float" } ] }"""), "float" },
        { Manifest(1, """{ "id": "A", "name": "A", "properties": [ { "id": "p", "name": "P", "kind": "enum" } ] }"""), "enum" },
        { Manifest(1, """{ "id": "A", "name": "A", "allowedChildren": ["Нет"] }"""), "Нет" },
        { Manifest(1, """{ "id": "A", "name": "A", "abstract": true, "sealed": true }"""), "abstract" },
        { Manifest(1, """{ "id": "A", "name": "A", "actions": [ { "id": "x", "name": "X", "placements": ["toolbar"] } ] }"""), "toolbar" },
        { Manifest(1, """{ "id": "A", "name": "A", "colorRules": [ { "property": "нет", "equals": "1", "color": "red" } ] }"""), "нет" },
    };

    [Theory]
    [MemberData(nameof(InvalidManifests))]
    public void Startup_InvalidManifest_FailsWithClearError(string manifest, string substring)
    {
        var database = NewDatabase(factory.ConnectionString);
        using var server = Server(database, ModulesDirectory(manifest));

        var error = Assert.ThrowsAny<Exception>(() => server.CreateClient());

        Assert.Contains(substring, error.ToString());
        Assert.Contains("manifest.json", error.ToString());
    }
}
