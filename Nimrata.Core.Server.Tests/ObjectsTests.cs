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

/// <summary>Объекты и наборы изменений: загрузка, атомарное применение, проверки по типам, журнал.</summary>
public sealed class ObjectsTests(ServerFactory фабрика) : IClassFixture<ServerFactory>, IAsyncLifetime
{
    private const string Манифест = """
        {
          "module": "demo", "version": 1,
          "types": [
            { "id": "Folder", "name": "Папка", "allowedChildren": ["Item", "Folder"] },
            { "id": "Item", "name": "Элемент", "sealed": true, "allowedChildren": [],
              "properties": [
                { "id": "title", "name": "Название", "kind": "string" },
                { "id": "body", "name": "Текст", "kind": "text" },
                { "id": "count", "name": "Число", "kind": "integer" },
                { "id": "done", "name": "Готово", "kind": "boolean" },
                { "id": "day", "name": "День", "kind": "date" },
                { "id": "at", "name": "Время", "kind": "time" },
                { "id": "level", "name": "Уровень", "kind": "enum",
                  "values": [ { "value": "low", "name": "Низкий" }, { "value": "high", "name": "Высокий" } ] },
                { "id": "ref", "name": "Ссылка", "kind": "reference" },
                { "id": "folderRef", "name": "Ссылка на папку", "kind": "reference", "targetTypes": ["Folder"] }
              ] },
            { "id": "Base", "name": "Абстрактный", "abstract": true },
            { "id": "Leaf", "name": "Лист", "allowedChildren": ["Item"] }
          ]
        }
        """;

    private const string ЧужойEmail = "other@example.test";
    private const string ЧужойПароль = "other-password-1";

    private string _каталог = null!;
    private string _база = null!;
    private WebApplicationFactory<Program> _сервер = null!;
    private HttpClient _я = null!;
    private HttpClient _другой = null!;

    public async Task InitializeAsync()
    {
        _каталог = Path.Combine(Path.GetTempPath(), "nimrata-objects-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(_каталог, "demo"));
        await File.WriteAllTextAsync(Path.Combine(_каталог, "demo", "manifest.json"), Манифест);
        _база = new NpgsqlConnectionStringBuilder(фабрика.ConnectionString) { Database = "o" + Guid.NewGuid().ToString("N"), Pooling = false }
            .ConnectionString;
        _сервер = фабрика.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, конфигурация) =>
            конфигурация.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = _база,
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

    private static object Создать(Guid id, string тип, Guid? родитель = null, double порядок = 1, object? свойства = null) =>
        new { op = "create", id, type = тип, parent = родитель, order = порядок, properties = свойства ?? new { } };

    private static Task<HttpResponseMessage> Применить(HttpClient клиент, params object[] операции) =>
        клиент.PostAsJsonAsync("/api/changesets", new { operations = операции });

    private static async Task<JsonElement[]> Загрузить(HttpClient клиент) =>
        (await клиент.GetFromJsonAsync<JsonElement[]>("/api/objects"))!;

    private static async Task ПроверитьОтказ(HttpResponseMessage ответ, HttpStatusCode статус, string подстрока)
    {
        Assert.Equal(статус, ответ.StatusCode);
        var причина = (await ответ.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString();
        Assert.Contains(подстрока, причина);
    }

    public static TheoryData<string, object, string> НевалидныеСвойства => new()
    {
        { "string", new { title = 5 }, "title" },
        { "text", new { body = true }, "body" },
        { "integer", new { count = "три" }, "count" },
        { "integer дробное", new { count = 1.5 }, "count" },
        { "boolean", new { done = "да" }, "done" },
        { "date", new { day = "2026-13-40" }, "day" },
        { "date формат", new { day = "01.02.2026" }, "day" },
        { "time", new { at = "25:61" }, "at" },
        { "enum вне списка", new { level = "medium" }, "level" },
        { "reference не guid", new { @ref = "abc" }, "ref" },
        { "неизвестное свойство", new { nope = "x" }, "nope" },
    };

    [Theory]
    [MemberData(nameof(НевалидныеСвойства))]
    public async Task Набор_СоздатьСОшибочнымЗначениемСвойства_Отклоняется(string _, object свойства, string имя)
    {
        var ответ = await Применить(_я, Создать(Guid.CreateVersion7(), "Item", null, 1, свойства));

        await ПроверитьОтказ(ответ, HttpStatusCode.UnprocessableEntity, имя);
        Assert.Empty(await Загрузить(_я));
    }

    [Fact]
    public async Task Набор_СоздатьСВерными_ЗначениямиВсехВидов_Принимается()
    {
        var папка = Guid.CreateVersion7();
        var ответ = await Применить(_я,
            Создать(папка, "Folder"),
            Создать(Guid.CreateVersion7(), "Item", папка, 1, new
            {
                title = "a", body = "b\nc", count = -2, done = true, day = "2026-02-28", at = "09:05",
                level = "low", @ref = папка, folderRef = папка,
            }));

        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
    }

    [Fact]
    public async Task Набор_СсылкаНаЧужойИлиНесуществующийОбъект_Отклоняется()
    {
        var чужой = Guid.CreateVersion7();
        await Применить(_другой, Создать(чужой, "Folder"));

        var наЧужой = await Применить(_я, Создать(Guid.CreateVersion7(), "Item", null, 1, new { @ref = чужой }));
        var наНесуществующий = await Применить(_я, Создать(Guid.CreateVersion7(), "Item", null, 1, new { @ref = Guid.NewGuid() }));

        await ПроверитьОтказ(наЧужой, HttpStatusCode.UnprocessableEntity, "ref");
        await ПроверитьОтказ(наНесуществующий, HttpStatusCode.UnprocessableEntity, "ref");
    }

    [Fact]
    public async Task Набор_СсылкаНаОбъектНедопустимогоТипа_Отклоняется()
    {
        var элемент = Guid.CreateVersion7();
        var папка = Guid.CreateVersion7();
        await Применить(_я, Создать(папка, "Folder"), Создать(элемент, "Item", папка));

        var ответ = await Применить(_я, Создать(Guid.CreateVersion7(), "Item", папка, 2, new { folderRef = элемент }));

        await ПроверитьОтказ(ответ, HttpStatusCode.UnprocessableEntity, "folderRef");
    }

    [Fact]
    public async Task Набор_НеизвестныйТип_Отклоняется()
    {
        var ответ = await Применить(_я, Создать(Guid.CreateVersion7(), "Nope"));

        await ПроверитьОтказ(ответ, HttpStatusCode.UnprocessableEntity, "Nope");
    }

    [Fact]
    public async Task Набор_АбстрактныйТип_Отклоняется()
    {
        var ответ = await Применить(_я, Создать(Guid.CreateVersion7(), "Base"));

        await ПроверитьОтказ(ответ, HttpStatusCode.UnprocessableEntity, "абстракт");
    }

    [Fact]
    public async Task Набор_РодительНеСуществует_Отклоняется()
    {
        var ответ = await Применить(_я, Создать(Guid.CreateVersion7(), "Item", Guid.NewGuid()));

        await ПроверитьОтказ(ответ, HttpStatusCode.UnprocessableEntity, "родител");
    }

    [Fact]
    public async Task Набор_РодительЧужой_ОтклоняетсяКакНесуществующий()
    {
        var чужаяПапка = Guid.CreateVersion7();
        await Применить(_другой, Создать(чужаяПапка, "Folder"));

        var ответ = await Применить(_я, Создать(Guid.CreateVersion7(), "Item", чужаяПапка));

        await ПроверитьОтказ(ответ, HttpStatusCode.UnprocessableEntity, "родител");
        Assert.Empty(await Загрузить(_я));
    }

    [Fact]
    public async Task Набор_РодительНеДопускаетТипРебёнка_Отклоняется()
    {
        var элемент = Guid.CreateVersion7();
        await Применить(_я, Создать(элемент, "Item"));

        var ответ = await Применить(_я, Создать(Guid.CreateVersion7(), "Folder", элемент));

        await ПроверитьОтказ(ответ, HttpStatusCode.UnprocessableEntity, "Folder");
    }

    [Fact]
    public async Task Набор_ИдентификаторУжеЗанят_Отклоняется()
    {
        var id = Guid.CreateVersion7();
        await Применить(_я, Создать(id, "Folder"));

        var своим = await Применить(_я, Создать(id, "Folder"));
        var чужим = await Применить(_другой, Создать(id, "Folder"));

        await ПроверитьОтказ(своим, HttpStatusCode.Conflict, "занят");
        await ПроверитьОтказ(чужим, HttpStatusCode.Conflict, "занят");
    }

    [Fact]
    public async Task Набор_ПоследняяОперацияОтклонена_НеПрименяетсяНиОдна()
    {
        var папка = Guid.CreateVersion7();

        var ответ = await Применить(_я, Создать(папка, "Folder"), Создать(Guid.CreateVersion7(), "Nope"));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, ответ.StatusCode);
        Assert.Empty(await Загрузить(_я));
        Assert.Equal(0, await ЧислоЗаписейЖурнала());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{ "operations": [] }""")]
    [InlineData("""{ "operations": [ { "op": "fly" } ] }""")]
    [InlineData("""{ "operations": [ { "op": "create", "type": "Folder" } ] }""")]
    public async Task Набор_НеверныйФормат_ОтклоняетсяСПричиной(string тело)
    {
        var ответ = await _я.PostAsync("/api/changesets",
            new StringContent(тело, System.Text.Encoding.UTF8, "application/json"));

        await ПроверитьОтказ(ответ, HttpStatusCode.UnprocessableEntity, "");
    }

    private static object Изменить(Guid id, object изменения) => new { op = "update", id, changes = изменения };

    private static object Переместить(Guid id, object? родитель = null, object? порядок = null) =>
        new { op = "move", id, parent = родитель, order = порядок };

    private static object Удалить(Guid id) => new { op = "delete", id };

    private static JsonElement Найти(JsonElement[] объекты, Guid id) =>
        объекты.Single(о => о.GetProperty("id").GetGuid() == id);

    [Fact]
    public async Task Набор_ИзменениеСвойства_ПриСовпавшемБылоПрименяется()
    {
        var id = Guid.CreateVersion7();
        await Применить(_я, Создать(id, "Item", null, 1, new { title = "Старое", count = 1 }));

        var ответ = await Применить(_я, Изменить(id, new
        {
            title = new { old = "Старое", @new = "Новое" },
            done = new { old = (string?)null, @new = true },
        }));

        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
        var свойства = Найти(await Загрузить(_я), id).GetProperty("properties");
        Assert.Equal("Новое", свойства.GetProperty("title").GetString());
        Assert.True(свойства.GetProperty("done").GetBoolean());
        Assert.Equal(1, свойства.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task Набор_ИзменениеСвойства_СНовымNull_УдаляетЗначение()
    {
        var id = Guid.CreateVersion7();
        await Применить(_я, Создать(id, "Item", null, 1, new { title = "Есть" }));

        var ответ = await Применить(_я, Изменить(id, new { title = new { old = "Есть", @new = (string?)null } }));

        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
        Assert.False(Найти(await Загрузить(_я), id).GetProperty("properties").TryGetProperty("title", out _));
    }

    [Fact]
    public async Task Набор_ИзменениеСвойства_БылоНеСовпало_ОтклоняетсяКонфликтомИНичегоНеМеняет()
    {
        var id = Guid.CreateVersion7();
        await Применить(_я, Создать(id, "Item", null, 1, new { title = "Текущее", count = 1 }));

        var ответ = await Применить(_я, Изменить(id, new
        {
            count = new { old = 1, @new = 2 },
            title = new { old = "Другое", @new = "Новое" },
        }));

        await ПроверитьОтказ(ответ, HttpStatusCode.Conflict, "title");
        var свойства = Найти(await Загрузить(_я), id).GetProperty("properties");
        Assert.Equal("Текущее", свойства.GetProperty("title").GetString());
        Assert.Equal(1, свойства.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task Набор_ИзменениеСвойства_ЗначениеНеПодходит_Отклоняется()
    {
        var id = Guid.CreateVersion7();
        await Применить(_я, Создать(id, "Item", null, 1, new { level = "low" }));

        var ответ = await Применить(_я, Изменить(id, new { level = new { old = "low", @new = "medium" } }));

        await ПроверитьОтказ(ответ, HttpStatusCode.UnprocessableEntity, "level");
    }

    [Fact]
    public async Task Набор_ИзменениеЧужогоИлиНесуществующегоОбъекта_Отклоняется()
    {
        var чужой = Guid.CreateVersion7();
        await Применить(_другой, Создать(чужой, "Item", null, 1, new { title = "Секрет" }));

        var наЧужой = await Применить(_я, Изменить(чужой, new { title = new { old = "Секрет", @new = "Взлом" } }));
        var наНесуществующий = await Применить(_я,
            Изменить(Guid.NewGuid(), new { title = new { old = (string?)null, @new = "x" } }));

        await ПроверитьОтказ(наЧужой, HttpStatusCode.UnprocessableEntity, "не найден");
        await ПроверитьОтказ(наНесуществующий, HttpStatusCode.UnprocessableEntity, "не найден");
        Assert.Equal("Секрет", Найти(await Загрузить(_другой), чужой).GetProperty("properties").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Набор_ПерваяОперацияВерна_ВтораяНет_ПерваяОткатывается()
    {
        var id = Guid.CreateVersion7();
        await Применить(_я, Создать(id, "Item", null, 1, new { title = "Исходное" }));

        var ответ = await Применить(_я,
            Изменить(id, new { title = new { old = "Исходное", @new = "Изменено" } }),
            Изменить(id, new { title = new { old = "Исходное", @new = "Опять" } }));

        Assert.Equal(HttpStatusCode.Conflict, ответ.StatusCode);
        Assert.Equal("Исходное", Найти(await Загрузить(_я), id).GetProperty("properties").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Набор_Перемещение_МенятРодителяИПорядок()
    {
        var а = Guid.CreateVersion7();
        var б = Guid.CreateVersion7();
        var элемент = Guid.CreateVersion7();
        await Применить(_я, Создать(а, "Folder", null, 1), Создать(б, "Folder", null, 2), Создать(элемент, "Item", а, 5));

        var ответ = await Применить(_я, Переместить(элемент,
            родитель: new { old = а, @new = б }, порядок: new { old = 5, @new = 1.5 }));

        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
        var после = Найти(await Загрузить(_я), элемент);
        Assert.Equal(б, после.GetProperty("parent").GetGuid());
        Assert.Equal(1.5, после.GetProperty("order").GetDouble());
    }

    [Fact]
    public async Task Набор_ПеремещениеВКорень_СбрасываетРодителя()
    {
        var папка = Guid.CreateVersion7();
        var вложенная = Guid.CreateVersion7();
        await Применить(_я, Создать(папка, "Folder"), Создать(вложенная, "Folder", папка));

        var ответ = await Применить(_я, Переместить(вложенная, родитель: new { old = папка, @new = (Guid?)null }));

        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
        Assert.Equal(JsonValueKind.Null, Найти(await Загрузить(_я), вложенная).GetProperty("parent").ValueKind);
    }

    [Fact]
    public async Task Набор_ПеремещениеСНевернымБыло_ОтклоняетсяКонфликтом()
    {
        var а = Guid.CreateVersion7();
        var б = Guid.CreateVersion7();
        var папка = Guid.CreateVersion7();
        await Применить(_я, Создать(а, "Folder"), Создать(б, "Folder"), Создать(папка, "Folder", а, 3));

        var неверныйРодитель = await Применить(_я, Переместить(папка, родитель: new { old = б, @new = (Guid?)null }));
        var неверныйПорядок = await Применить(_я, Переместить(папка, порядок: new { old = 99, @new = 1 }));

        await ПроверитьОтказ(неверныйРодитель, HttpStatusCode.Conflict, "parent");
        await ПроверитьОтказ(неверныйПорядок, HttpStatusCode.Conflict, "order");
    }

    [Fact]
    public async Task Набор_ПеремещениеПодНедопустимогоРодителяИлиВСебя_Отклоняется()
    {
        var папка = Guid.CreateVersion7();
        var вложенная = Guid.CreateVersion7();
        var элемент = Guid.CreateVersion7();
        await Применить(_я, Создать(папка, "Folder"), Создать(вложенная, "Folder", папка), Создать(элемент, "Item", папка));

        var подЭлемент = await Применить(_я, Переместить(вложенная, родитель: new { old = папка, @new = элемент }));
        var вСебя = await Применить(_я, Переместить(папка, родитель: new { old = (Guid?)null, @new = папка }));
        var вПотомка = await Применить(_я, Переместить(папка, родитель: new { old = (Guid?)null, @new = вложенная }));

        await ПроверитьОтказ(подЭлемент, HttpStatusCode.UnprocessableEntity, "Folder");
        await ПроверитьОтказ(вСебя, HttpStatusCode.UnprocessableEntity, "цикл");
        await ПроверитьОтказ(вПотомка, HttpStatusCode.UnprocessableEntity, "цикл");
    }

    [Fact]
    public async Task Набор_ПеремещениеЧужогоОбъектаИлиПодЧужогоРодителя_Отклоняется()
    {
        var чужаяПапка = Guid.CreateVersion7();
        var моя = Guid.CreateVersion7();
        await Применить(_другой, Создать(чужаяПапка, "Folder"));
        await Применить(_я, Создать(моя, "Folder"));

        var чужогоОбъекта = await Применить(_я, Переместить(чужаяПапка, порядок: new { old = 1, @new = 2 }));
        var подЧужого = await Применить(_я, Переместить(моя, родитель: new { old = (Guid?)null, @new = чужаяПапка }));

        await ПроверитьОтказ(чужогоОбъекта, HttpStatusCode.UnprocessableEntity, "не найден");
        await ПроверитьОтказ(подЧужого, HttpStatusCode.UnprocessableEntity, "родител");
    }

    [Fact]
    public async Task Набор_УдалениеПоддерева_ПеречисленныеОбъектыУдаляются()
    {
        var папка = Guid.CreateVersion7();
        var элемент = Guid.CreateVersion7();
        var остаётся = Guid.CreateVersion7();
        await Применить(_я, Создать(папка, "Folder"), Создать(элемент, "Item", папка), Создать(остаётся, "Folder"));

        var ответ = await Применить(_я, Удалить(элемент), Удалить(папка));

        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
        Assert.Equal([остаётся], (await Загрузить(_я)).Select(о => о.GetProperty("id").GetGuid()));
    }

    [Fact]
    public async Task Набор_УдалениеРодителяБезПотомков_ОтклоняетсяПотомкиНеУдаляютсяНеявно()
    {
        var папка = Guid.CreateVersion7();
        var элемент = Guid.CreateVersion7();
        await Применить(_я, Создать(папка, "Folder"), Создать(элемент, "Item", папка));

        var ответ = await Применить(_я, Удалить(папка));

        await ПроверитьОтказ(ответ, HttpStatusCode.UnprocessableEntity, "потомк");
        Assert.Equal(2, (await Загрузить(_я)).Length);
    }

    [Fact]
    public async Task Набор_УдалениеЧужогоИлиНесуществующего_Отклоняется()
    {
        var чужой = Guid.CreateVersion7();
        await Применить(_другой, Создать(чужой, "Folder"));

        var чужого = await Применить(_я, Удалить(чужой));
        var несуществующего = await Применить(_я, Удалить(Guid.NewGuid()));

        await ПроверитьОтказ(чужого, HttpStatusCode.UnprocessableEntity, "не найден");
        await ПроверитьОтказ(несуществующего, HttpStatusCode.UnprocessableEntity, "не найден");
        Assert.Single(await Загрузить(_другой));
    }

    private sealed record ЗаписьЖурнала(string Operation, string? Property, JsonElement? Old, JsonElement? New, JsonElement? Snapshot);

    private async Task<List<ЗаписьЖурнала>> Журнал(Guid объект)
    {
        await using var соединение = new NpgsqlConnection(_база);
        return (await Dapper.SqlMapper.QueryAsync<ЗаписьЖурнала>(соединение,
            """
            select operation as Operation, property as Property, old_value as Old, new_value as New, snapshot as Snapshot
            from changeset_entries where object_id = @объект order by id
            """, new { объект })).ToList();
    }

    [Fact]
    public async Task Журнал_ОперацииНабора_ЗаписываютсяСБылоСтало()
    {
        var а = Guid.CreateVersion7();
        var б = Guid.CreateVersion7();
        var id = Guid.CreateVersion7();
        await Применить(_я, Создать(а, "Folder"), Создать(б, "Folder"));
        await Применить(_я, Создать(id, "Item", а, 1, new { title = "Один" }));
        await Применить(_я, Изменить(id, new { title = new { old = "Один", @new = "Два" } }));
        await Применить(_я, Переместить(id, родитель: new { old = а, @new = б }));

        var журнал = await Журнал(id);

        Assert.Equal(["create", "update", "move"], журнал.Select(з => з.Operation));
        Assert.Equal("Item", журнал[0].New!.Value.GetProperty("type").GetString());
        Assert.Equal("Один", журнал[0].New!.Value.GetProperty("properties").GetProperty("title").GetString());
        Assert.Equal("title", журнал[1].Property);
        Assert.Equal("Один", журнал[1].Old!.Value.GetString());
        Assert.Equal("Два", журнал[1].New!.Value.GetString());
        Assert.Equal(а, журнал[2].Old!.Value.GetProperty("parent").GetGuid());
        Assert.Equal(б, журнал[2].New!.Value.GetProperty("parent").GetGuid());
    }

    [Fact]
    public async Task Журнал_Удаление_ХранитПолныйСнимокОбъекта()
    {
        var папка = Guid.CreateVersion7();
        var id = Guid.CreateVersion7();
        await Применить(_я, Создать(папка, "Folder"), Создать(id, "Item", папка, 4, new { title = "Память", count = 7 }));

        await Применить(_я, Удалить(id));

        var запись = (await Журнал(id)).Last();
        Assert.Equal("delete", запись.Operation);
        var снимок = запись.Snapshot!.Value;
        Assert.Equal("Item", снимок.GetProperty("type").GetString());
        Assert.Equal(папка, снимок.GetProperty("parent").GetGuid());
        Assert.Equal(4, снимок.GetProperty("order").GetDouble());
        Assert.Equal("Память", снимок.GetProperty("properties").GetProperty("title").GetString());
        Assert.Equal(7, снимок.GetProperty("properties").GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task Журнал_ОтклонённыйНабор_НеОставляетСледов()
    {
        await Применить(_я, Удалить(Guid.NewGuid()));

        await using var соединение = new NpgsqlConnection(_база);
        Assert.Equal(0, await Dapper.SqlMapper.ExecuteScalarAsync<long>(соединение, "select count(*) from changesets"));
    }

    [Fact]
    public async Task Журнал_ЗаписьНабора_ПринадлежитАвтору()
    {
        var ответ = await Применить(_другой, Создать(Guid.CreateVersion7(), "Folder"));
        var набор = (await ответ.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        await using var соединение = new NpgsqlConnection(_база);
        var автор = await Dapper.SqlMapper.ExecuteScalarAsync<string>(соединение,
            "select u.email from changesets c join users u on u.id = c.user_id where c.id = @набор", new { набор });
        Assert.Equal(ЧужойEmail, автор);
    }

    [Theory]
    [InlineData("update changeset_entries set new_value = '1'")]
    [InlineData("delete from changeset_entries")]
    [InlineData("update changesets set created_at = now()")]
    [InlineData("delete from changesets")]
    public async Task Журнал_ПравкаИУдаление_ЗапрещеныВБазе(string запрос)
    {
        await Применить(_я, Создать(Guid.CreateVersion7(), "Folder"));
        await using var соединение = new NpgsqlConnection(_база);

        await Assert.ThrowsAsync<PostgresException>(() => Dapper.SqlMapper.ExecuteAsync(соединение, запрос));
    }

    private async Task<long> ЧислоЗаписейЖурнала()
    {
        await using var соединение = new NpgsqlConnection(_база);
        return await Dapper.SqlMapper.ExecuteScalarAsync<long>(соединение, "select count(*) from changeset_entries");
    }

    [Fact]
    public async Task Объекты_БезТокена_Возвращает401()
    {
        using var аноним = _сервер.CreateClient();

        var ответ = await аноним.GetAsync("/api/objects");

        Assert.Equal(HttpStatusCode.Unauthorized, ответ.StatusCode);
    }

    [Fact]
    public async Task Набор_СозданиеОбъектов_ПоявляетсяВЗагрузкеСДаннымиКлиента()
    {
        var папка = Guid.CreateVersion7();
        var элемент = Guid.CreateVersion7();

        var ответ = await Применить(_я,
            Создать(папка, "Folder", null, 1),
            Создать(элемент, "Item", папка, 2.5, new { title = "Первый", count = 3, done = false, level = "high" }));

        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
        var объекты = await Загрузить(_я);
        Assert.Equal(2, объекты.Length);
        var загружен = объекты.Single(о => о.GetProperty("id").GetGuid() == элемент);
        Assert.Equal("Item", загружен.GetProperty("type").GetString());
        Assert.Equal(папка, загружен.GetProperty("parent").GetGuid());
        Assert.Equal(2.5, загружен.GetProperty("order").GetDouble());
        Assert.Equal("Первый", загружен.GetProperty("properties").GetProperty("title").GetString());
        Assert.Equal(3, загружен.GetProperty("properties").GetProperty("count").GetInt32());
        var корень = объекты.Single(о => о.GetProperty("id").GetGuid() == папка);
        Assert.Equal(JsonValueKind.Null, корень.GetProperty("parent").ValueKind);
    }

    [Fact]
    public async Task Загрузка_ВозвращаетТолькоОбъектыТекущегоПользователя()
    {
        var мой = Guid.CreateVersion7();
        var чужой = Guid.CreateVersion7();
        await Применить(_я, Создать(мой, "Folder"));
        await Применить(_другой, Создать(чужой, "Folder"));

        var моиОбъекты = await Загрузить(_я);
        var чужиеОбъекты = await Загрузить(_другой);

        Assert.Equal([мой], моиОбъекты.Select(о => о.GetProperty("id").GetGuid()));
        Assert.Equal([чужой], чужиеОбъекты.Select(о => о.GetProperty("id").GetGuid()));
    }
}
