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

/// <summary>Манифест модуля: загрузка в таблицу типов при старте и выдача типов по API.</summary>
public sealed class ManifestTests(ServerFactory фабрика) : IClassFixture<ServerFactory>, IDisposable
{
    private readonly List<string> _каталоги = [];

    public void Dispose()
    {
        foreach (var каталог in _каталоги) Directory.Delete(каталог, recursive: true);
    }

    private static string ТипJson(string id, string имя = "Тип") =>
        $$"""{ "id": "{{id}}", "name": "{{имя}}" }""";

    private static string Манифест(int версия, params string[] типы) =>
        $$"""{ "module": "demo", "version": {{версия}}, "types": [ {{string.Join(",", типы)}} ] }""";

    /// <summary>Каталог модулей с одним манифестом.</summary>
    private string Каталог(string манифест)
    {
        var каталог = Path.Combine(Path.GetTempPath(), "nimrata-modules-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(каталог, "demo"));
        File.WriteAllText(Path.Combine(каталог, "demo", "manifest.json"), манифест);
        _каталоги.Add(каталог);
        return каталог;
    }

    private static string НоваяБаза(string строка) =>
        new NpgsqlConnectionStringBuilder(строка) { Database = "m" + Guid.NewGuid().ToString("N") }.ConnectionString;

    private WebApplicationFactory<Program> Сервер(string база, string? каталог) =>
        фабрика.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, конфигурация) =>
        {
            var значения = new Dictionary<string, string?> { ["ConnectionStrings:Default"] = база };
            if (каталог is not null) значения["Modules:Path"] = каталог;
            конфигурация.AddInMemoryCollection(значения);
        }));

    private static async Task<JsonElement[]> Типы(HttpClient клиент)
    {
        var вход = await клиент.PostAsJsonAsync("/api/auth/login",
            new { email = ServerFactory.AdminEmail, password = ServerFactory.AdminPassword });
        var токен = (await вход.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        клиент.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", токен);
        return (await клиент.GetFromJsonAsync<JsonElement[]>("/api/types"))!;
    }

    private static async Task<long> ЧислоСтрок(string база)
    {
        await using var соединение = new NpgsqlConnection(база);
        return await соединение.ExecuteScalarAsync<long>("select count(*) from types");
    }

    private static string Ид(JsonElement тип) => тип.GetProperty("id").GetString()!;

    [Fact]
    public async Task Типы_БезТокена_Возвращает401()
    {
        using var клиент = фабрика.CreateClient();

        var ответ = await клиент.GetAsync("/api/types");

        Assert.Equal(HttpStatusCode.Unauthorized, ответ.StatusCode);
    }

    [Fact]
    public async Task Типы_МанифестТрекераПоУмолчанию_ВозвращаетЗаметкуИГруппуЗаметок()
    {
        using var клиент = фабрика.CreateClient();

        var типы = await Типы(клиент);

        var ид = типы.Select(Ид).ToList();
        Assert.Contains("Note", ид);
        Assert.Contains("NoteGroup", ид);
        var заметка = типы.Single(т => Ид(т) == "Note");
        Assert.Equal("tracker", заметка.GetProperty("module").GetString());
        Assert.Contains(заметка.GetProperty("properties").EnumerateArray(),
            с => с.GetProperty("id").GetString() == "priority" && с.GetProperty("kind").GetString() == "enum");
    }

    [Fact]
    public async Task Старт_ЗагружаетТипыИзМанифеста()
    {
        var база = НоваяБаза(фабрика.ConnectionString);
        using var сервер = Сервер(база, Каталог(Манифест(1, ТипJson("A", "Первый"), ТипJson("B"))));
        using var клиент = сервер.CreateClient();

        var типы = await Типы(клиент);

        Assert.Equal(["A", "B"], типы.Select(Ид).Order());
        var a = типы.Single(т => Ид(т) == "A");
        Assert.Equal("Первый", a.GetProperty("name").GetString());
        Assert.Equal(1, a.GetProperty("moduleVersion").GetInt32());
    }

    [Fact]
    public async Task ПовторныйСтарт_ТойЖеВерсии_НеДублируетТипы()
    {
        var база = НоваяБаза(фабрика.ConnectionString);
        var каталог = Каталог(Манифест(1, ТипJson("A"), ТипJson("B")));
        using (var первый = Сервер(база, каталог))
        {
            using var к = первый.CreateClient();
            await Типы(к);
        }

        using var второй = Сервер(база, каталог);
        using var клиент = второй.CreateClient();
        var типы = await Типы(клиент);

        Assert.Equal(2, типы.Length);
        Assert.Equal(2, await ЧислоСтрок(база));
    }

    [Fact]
    public async Task Старт_СНовойВерсиейМанифеста_ОбновляетТипыИДобавляетНовые()
    {
        var база = НоваяБаза(фабрика.ConnectionString);
        var каталог = Каталог(Манифест(1, ТипJson("A", "Старое имя")));
        using (var первый = Сервер(база, каталог))
        {
            using var к = первый.CreateClient();
            await Типы(к);
        }
        File.WriteAllText(Path.Combine(каталог, "demo", "manifest.json"),
            Манифест(2, ТипJson("A", "Новое имя"), ТипJson("C")));

        using var второй = Сервер(база, каталог);
        using var клиент = второй.CreateClient();
        var типы = await Типы(клиент);

        Assert.Equal(2, типы.Length);
        var a = типы.Single(т => Ид(т) == "A");
        Assert.Equal("Новое имя", a.GetProperty("name").GetString());
        Assert.Equal(2, a.GetProperty("moduleVersion").GetInt32());
    }

    [Fact]
    public async Task Старт_СТойЖеВерсиейНоДругимСодержимым_НеПерезаписываетТипы()
    {
        var база = НоваяБаза(фабрика.ConnectionString);
        var каталог = Каталог(Манифест(1, ТипJson("A", "Исходное")));
        using (var первый = Сервер(база, каталог))
        {
            using var к = первый.CreateClient();
            await Типы(к);
        }
        File.WriteAllText(Path.Combine(каталог, "demo", "manifest.json"), Манифест(1, ТипJson("A", "Правка без версии")));

        using var второй = Сервер(база, каталог);
        using var клиент = второй.CreateClient();
        var типы = await Типы(клиент);

        Assert.Equal("Исходное", типы.Single().GetProperty("name").GetString());
    }

    public static TheoryData<string, string> НевалидныеМанифесты => new()
    {
        { "{ не json", "JSON" },
        { """{ "module": "demo", "types": [] }""", "version" },
        { """{ "module": "demo", "version": 1 }""", "types" },
        { Манифест(1, """{ "name": "Без id" }"""), "id" },
        { Манифест(1, ТипJson("A"), ТипJson("A")), "повторяется" },
        { Манифест(1, """{ "id": "A", "name": "A", "properties": [ { "id": "p", "name": "P", "kind": "float" } ] }"""), "float" },
        { Манифест(1, """{ "id": "A", "name": "A", "properties": [ { "id": "p", "name": "P", "kind": "enum" } ] }"""), "enum" },
        { Манифест(1, """{ "id": "A", "name": "A", "allowedChildren": ["Нет"] }"""), "Нет" },
        { Манифест(1, """{ "id": "A", "name": "A", "abstract": true, "sealed": true }"""), "abstract" },
        { Манифест(1, """{ "id": "A", "name": "A", "actions": [ { "id": "x", "name": "X", "placements": ["toolbar"] } ] }"""), "toolbar" },
        { Манифест(1, """{ "id": "A", "name": "A", "colorRules": [ { "property": "нет", "equals": "1", "color": "red" } ] }"""), "нет" },
    };

    [Theory]
    [MemberData(nameof(НевалидныеМанифесты))]
    public void Старт_НевалидныйМанифест_ОстанавливаетсяСПонятнойОшибкой(string манифест, string подстрока)
    {
        var база = НоваяБаза(фабрика.ConnectionString);
        using var сервер = Сервер(база, Каталог(манифест));

        var ошибка = Assert.ThrowsAny<Exception>(() => сервер.CreateClient());

        Assert.Contains(подстрока, ошибка.ToString());
        Assert.Contains("manifest.json", ошибка.ToString());
    }
}
