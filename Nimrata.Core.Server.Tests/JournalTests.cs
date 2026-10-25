using Nimrata.Core.Server.Controllers.Responses;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nimrata.Core.Server.Auth;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

/// <summary>Чтение журнала: по объекту и «все мои изменения», постранично, только свои записи</summary>
public sealed class JournalTests(ServerFactory factory) : IClassFixture<ServerFactory>, IAsyncLifetime
{
    private const string Manifest = """
        {
          "module": "demo", "version": 1,
          "types": [
            { "id": "Folder", "name": "Папка", "allowedChildren": ["Item", "Folder"] },
            { "id": "Item", "name": "Элемент", "sealed": true, "allowedChildren": [],
              "properties": [ { "id": "title", "name": "Название", "kind": "string" } ] }
          ]
        }
        """;

    private const string ForeignEmail = "journal-other@example.test";
    private const string ForeignPassword = "other-password-1";

    private string _directory = null!;
    private WebApplicationFactory<Program> _server = null!;
    private HttpClient _me = null!;
    private HttpClient _other = null!;

    public async Task InitializeAsync()
    {
        _directory = Path.Combine(Path.GetTempPath(), "nimrata-journal-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(_directory, "demo"));
        await File.WriteAllTextAsync(Path.Combine(_directory, "demo", "manifest.json"), Manifest);
        var database = new NpgsqlConnectionStringBuilder(factory.ConnectionString)
            { Database = "j" + Guid.NewGuid().ToString("N"), Pooling = false }.ConnectionString;
        _server = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = database,
                ["Modules:Path"] = _directory,
            })));
        _me = await Login(ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        await _server.Services.GetRequiredService<AuthService>().CreateUserAsync(ForeignEmail, ForeignPassword, false);
        _other = await Login(ForeignEmail, ForeignPassword);
    }

    public Task DisposeAsync()
    {
        _me?.Dispose();
        _other?.Dispose();
        _server?.Dispose();
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
        return Task.CompletedTask;
    }

    private async Task<HttpClient> Login(string email, string password)
    {
        var client = _server.CreateClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password = password });
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task Apply(HttpClient client, params object[] operations)
    {
        var response = await client.PostAsJsonAsync("/api/changesets", new { operations = operations });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static object Create(Guid id, string type, Guid? parent = null, double order = 1, object? properties = null) =>
        new { op = "create", id, type = type, parent = parent, order = order, properties = properties ?? new { } };

    private static async Task<JsonElement> Journal(HttpClient client, string request = "")
    {
        var response = await client.GetAsync("/api/journal" + request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static string[] Operations(JsonElement page) =>
        page.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("operation").GetString()!).ToArray();

    private static Guid[] Objects(JsonElement page) =>
        page.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("objectId").GetGuid()).ToArray();

    [Fact]
    public async Task Journal_ByObject_EntriesNewestFirst()
    {
        var folder = Guid.CreateVersion7();
        var item = Guid.CreateVersion7();
        await Apply(_me, Create(folder, "Folder"), Create(item, "Item", folder, 1, new { title = "а" }));
        await Apply(_me, new { op = "update", id = item, changes = new { title = new { old = "а", @new = "б" } } });
        await Apply(_me, new { op = "move", id = item, parent = new { old = folder, @new = (Guid?)null } });

        var page = await Journal(_me, $"?objectId={item}");

        Assert.Equal(["move", "update", "create"], Operations(page));
        Assert.Equal(3, page.GetProperty("total").GetInt32());
        var update = page.GetProperty("items")[1];
        Assert.Equal("title", update.GetProperty("property").GetString());
        Assert.Equal("а", update.GetProperty("old").GetString());
        Assert.Equal("б", update.GetProperty("new").GetString());
        Assert.Equal(ServerFactory.AdminEmail, update.GetProperty("user").GetString());
        Assert.Equal(item, update.GetProperty("objectId").GetGuid());
        Assert.True(update.TryGetProperty("at", out _));
        var move = page.GetProperty("items")[0];
        Assert.Equal(folder, move.GetProperty("old").GetProperty("parent").GetGuid());
        Assert.Equal(JsonValueKind.Null, move.GetProperty("new").GetProperty("parent").ValueKind);
    }

    [Fact]
    public async Task Journal_AllMine_IncludesAllObjectsAndNoForeignOnes()
    {
        var myObject = Guid.CreateVersion7();
        var foreignObject = Guid.CreateVersion7();
        await Apply(_me, Create(myObject, "Folder"));
        await Apply(_other, Create(foreignObject, "Folder"));

        var myJournal = await Journal(_me);
        var foreignJournal = await Journal(_other);

        Assert.Equal([myObject], Objects(myJournal));
        Assert.Equal([foreignObject], Objects(foreignJournal));
    }

    [Fact]
    public async Task Journal_ByForeignObject_IsEmpty()
    {
        var foreign = Guid.CreateVersion7();
        await Apply(_other, Create(foreign, "Folder"));

        var page = await Journal(_me, $"?objectId={foreign}");

        Assert.Empty(page.GetProperty("items").EnumerateArray());
        Assert.Equal(0, page.GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Journal_DeletedObject_KeepsSnapshot()
    {
        var id = Guid.CreateVersion7();
        await Apply(_me, Create(id, "Item", null, 1, new { title = "x" }));
        await Apply(_me, new { op = "delete", id });

        var page = await Journal(_me, $"?objectId={id}");

        Assert.Equal(["delete", "create"], Operations(page));
        var snapshot = page.GetProperty("items")[0].GetProperty("snapshot");
        Assert.Equal("Item", snapshot.GetProperty("type").GetString());
        Assert.Equal("x", snapshot.GetProperty("properties").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Journal_Paged_ReturnsRequestedPage()
    {
        var ids = Enumerable.Range(0, 5).Select(_ => Guid.CreateVersion7()).ToArray();
        foreach (var id in ids) await Apply(_me, Create(id, "Folder"));

        var first = await Journal(_me, "?skip=0&take=2");
        var second = await Journal(_me, "?skip=2&take=2");

        Assert.Equal(5, first.GetProperty("total").GetInt32());
        Assert.Equal([ids[4], ids[3]], Objects(first));
        Assert.Equal([ids[2], ids[1]], Objects(second));
    }

    [Fact]
    public async Task Journal_WithoutLogin_Returns401()
    {
        var response = await _server.CreateClient().GetAsync("/api/journal");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Journal_InvalidParameter_Returns400()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await _me.GetAsync("/api/journal?take=0")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _me.GetAsync("/api/journal?skip=-1")).StatusCode);
    }

    [Fact]
    public async Task Journal_ModifyingViaApi_IsNotAllowed()
    {
        var response = await _me.PostAsJsonAsync("/api/journal", new { });
        Assert.True(response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed);
        response = await _me.DeleteAsync("/api/journal");
        Assert.True(response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed);
    }
}
