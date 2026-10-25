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

/// <summary>Чтение журнала: по объекту и «все мои изменения», постранично, только свои записи.</summary>
public sealed class JournalTests(ServerFactory фабрика) : IClassFixture<ServerFactory>, IAsyncLifetime
{
    private const string Манифест = """
        {
          "module": "demo", "version": 1,
          "types": [
            { "id": "Folder", "name": "Папка", "allowedChildren": ["Item", "Folder"] },
            { "id": "Item", "name": "Элемент", "sealed": true, "allowedChildren": [],
              "properties": [ { "id": "title", "name": "Название", "kind": "string" } ] }
          ]
        }
        """;

    private const string ЧужойEmail = "journal-other@example.test";
    private const string ЧужойПароль = "other-password-1";

    private string _каталог = null!;
    private WebApplicationFactory<Program> _сервер = null!;
    private HttpClient _я = null!;
    private HttpClient _другой = null!;

    public async Task InitializeAsync()
    {
        _каталог = Path.Combine(Path.GetTempPath(), "nimrata-journal-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(_каталог, "demo"));
        await File.WriteAllTextAsync(Path.Combine(_каталог, "demo", "manifest.json"), Манифест);
        var база = new NpgsqlConnectionStringBuilder(фабрика.ConnectionString)
            { Database = "j" + Guid.NewGuid().ToString("N"), Pooling = false }.ConnectionString;
        _сервер = фабрика.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, конфигурация) =>
            конфигурация.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = база,
                ["Modules:Path"] = _каталог,
            })));
        _я = await Войти(ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        await _сервер.Services.GetRequiredService<AuthService>().СоздатьПользователя(ЧужойEmail, ЧужойПароль, false);
        _другой = await Войти(ЧужойEmail, ЧужойПароль);
    }

    public Task DisposeAsync()
    {
        _я?.Dispose();
        _другой?.Dispose();
        _сервер?.Dispose();
        if (Directory.Exists(_каталог)) Directory.Delete(_каталог, recursive: true);
        return Task.CompletedTask;
    }

    private async Task<HttpClient> Войти(string email, string пароль)
    {
        var клиент = _сервер.CreateClient();
        var вход = await клиент.PostAsJsonAsync("/api/auth/login", new { email, password = пароль });
        var токен = (await вход.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        клиент.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", токен);
        return клиент;
    }

    private static async Task Применить(HttpClient клиент, params object[] операции)
    {
        var ответ = await клиент.PostAsJsonAsync("/api/changesets", new { operations = операции });
        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
    }

    private static object Создать(Guid id, string тип, Guid? родитель = null, double порядок = 1, object? свойства = null) =>
        new { op = "create", id, type = тип, parent = родитель, order = порядок, properties = свойства ?? new { } };

    private static async Task<JsonElement> Журнал(HttpClient клиент, string запрос = "")
    {
        var ответ = await клиент.GetAsync("/api/journal" + запрос);
        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
        return await ответ.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static string[] Операции(JsonElement страница) =>
        страница.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("operation").GetString()!).ToArray();

    private static Guid[] Объекты(JsonElement страница) =>
        страница.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("objectId").GetGuid()).ToArray();

    [Fact]
    public async Task Журнал_ПоОбъекту_ЗаписиОтНовыхКСтарым()
    {
        var папка = Guid.CreateVersion7();
        var элемент = Guid.CreateVersion7();
        await Применить(_я, Создать(папка, "Folder"), Создать(элемент, "Item", папка, 1, new { title = "а" }));
        await Применить(_я, new { op = "update", id = элемент, changes = new { title = new { old = "а", @new = "б" } } });
        await Применить(_я, new { op = "move", id = элемент, parent = new { old = папка, @new = (Guid?)null } });

        var страница = await Журнал(_я, $"?objectId={элемент}");

        Assert.Equal(["move", "update", "create"], Операции(страница));
        Assert.Equal(3, страница.GetProperty("total").GetInt32());
        var обновление = страница.GetProperty("items")[1];
        Assert.Equal("title", обновление.GetProperty("property").GetString());
        Assert.Equal("а", обновление.GetProperty("old").GetString());
        Assert.Equal("б", обновление.GetProperty("new").GetString());
        Assert.Equal(ServerFactory.AdminEmail, обновление.GetProperty("user").GetString());
        Assert.Equal(элемент, обновление.GetProperty("objectId").GetGuid());
        Assert.True(обновление.TryGetProperty("at", out _));
        var перенос = страница.GetProperty("items")[0];
        Assert.Equal(папка, перенос.GetProperty("old").GetProperty("parent").GetGuid());
        Assert.Equal(JsonValueKind.Null, перенос.GetProperty("new").GetProperty("parent").ValueKind);
    }

    [Fact]
    public async Task Журнал_ВсеМои_ВключаетВсеОбъектыИНеЧужие()
    {
        var мой = Guid.CreateVersion7();
        var другого = Guid.CreateVersion7();
        await Применить(_я, Создать(мой, "Folder"));
        await Применить(_другой, Создать(другого, "Folder"));

        var мои = await Журнал(_я);
        var его = await Журнал(_другой);

        Assert.Equal([мой], Объекты(мои));
        Assert.Equal([другого], Объекты(его));
    }

    [Fact]
    public async Task Журнал_ПоЧужомуОбъекту_Пуст()
    {
        var чужой = Guid.CreateVersion7();
        await Применить(_другой, Создать(чужой, "Folder"));

        var страница = await Журнал(_я, $"?objectId={чужой}");

        Assert.Empty(страница.GetProperty("items").EnumerateArray());
        Assert.Equal(0, страница.GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Журнал_УдалённыйОбъект_ОстаётсяСоСнимком()
    {
        var id = Guid.CreateVersion7();
        await Применить(_я, Создать(id, "Item", null, 1, new { title = "x" }));
        await Применить(_я, new { op = "delete", id });

        var страница = await Журнал(_я, $"?objectId={id}");

        Assert.Equal(["delete", "create"], Операции(страница));
        var снимок = страница.GetProperty("items")[0].GetProperty("snapshot");
        Assert.Equal("Item", снимок.GetProperty("type").GetString());
        Assert.Equal("x", снимок.GetProperty("properties").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Журнал_Постранично()
    {
        var ids = Enumerable.Range(0, 5).Select(_ => Guid.CreateVersion7()).ToArray();
        foreach (var id in ids) await Применить(_я, Создать(id, "Folder"));

        var первая = await Журнал(_я, "?skip=0&take=2");
        var вторая = await Журнал(_я, "?skip=2&take=2");

        Assert.Equal(5, первая.GetProperty("total").GetInt32());
        Assert.Equal([ids[4], ids[3]], Объекты(первая));
        Assert.Equal([ids[2], ids[1]], Объекты(вторая));
    }

    [Fact]
    public async Task Журнал_БезВхода_401()
    {
        var ответ = await _сервер.CreateClient().GetAsync("/api/journal");
        Assert.Equal(HttpStatusCode.Unauthorized, ответ.StatusCode);
    }

    [Fact]
    public async Task Журнал_НеверныйПараметр_400()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await _я.GetAsync("/api/journal?take=0")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _я.GetAsync("/api/journal?skip=-1")).StatusCode);
    }

    [Fact]
    public async Task Журнал_ИзменятьЧерезAPIНельзя()
    {
        var ответ = await _я.PostAsJsonAsync("/api/journal", new { });
        Assert.True(ответ.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed);
        ответ = await _я.DeleteAsync("/api/journal");
        Assert.True(ответ.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed);
    }
}
