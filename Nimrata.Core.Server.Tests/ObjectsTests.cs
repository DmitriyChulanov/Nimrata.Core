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

/// <summary>
/// Объекты и наборы изменений: загрузка, атомарное применение, проверки по типам, журнал
/// </summary>
public sealed class ObjectsTests(ServerFactory factory) : IClassFixture<ServerFactory>, IAsyncLifetime
{
    private const string Manifest = """
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

    private const string ForeignEmail = "other@example.test";
    private const string ForeignPassword = "other-password-1";

    private string _directory = null!;
    private string _database = null!;
    private WebApplicationFactory<Program> _server = null!;
    private HttpClient _me = null!;
    private HttpClient _other = null!;

    /// <summary>
    /// Готовит двух пользователей и клиентов для тестов объектов
    /// </summary>
    /// <returns>Задача подготовки</returns>
    public async Task InitializeAsync()
    {
        _directory = Path.Combine(Path.GetTempPath(), "nimrata-objects-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(_directory, "demo"));
        await File.WriteAllTextAsync(Path.Combine(_directory, "demo", "manifest.json"), Manifest);
        _database = new NpgsqlConnectionStringBuilder(factory.ConnectionString) { Database = "o" + Guid.NewGuid().ToString("N"), Pooling = false }
            .ConnectionString;
        _server = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = _database,
                ["Modules:Path"] = _directory,
            })));
        _me = await Login(ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        await _server.Services.GetRequiredService<AuthService>().CreateUserAsync(ForeignEmail, ForeignPassword, false);
        _other = await Login(ForeignEmail, ForeignPassword);
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
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password = password });
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>
    /// Описывает операцию создания объекта
    /// </summary>
    /// <param name="id">Идентификатор</param>
    /// <param name="type">Тип</param>
    /// <param name="parent">Родитель</param>
    /// <param name="order">Порядок</param>
    /// <param name="properties">Свойства</param>
    /// <returns>Операция набора</returns>
    private static object Create(Guid id, string type, Guid? parent = null, double order = 1, object? properties = null) =>
        new { op = "create", id, type = type, parent = parent, order = order, properties = properties ?? new { } };

    /// <summary>
    /// Отправляет набор изменений
    /// </summary>
    /// <param name="client">Клиент HTTP</param>
    /// <param name="operations">Операции набора</param>
    /// <returns>Ответ сервера</returns>
    private static Task<HttpResponseMessage> Apply(HttpClient client, params object[] operations) =>
        client.PostAsJsonAsync("/api/changesets", new { operations = operations });

    /// <summary>
    /// Загружает объекты пользователя
    /// </summary>
    /// <param name="client">Клиент HTTP</param>
    /// <returns>Массив объектов</returns>
    private static async Task<JsonElement[]> Load(HttpClient client) =>
        (await client.GetFromJsonAsync<JsonElement[]>("/api/objects"))!;

    /// <summary>
    /// Проверяет, что набор отклонён с нужным кодом и причиной
    /// </summary>
    /// <param name="response">Ответ сервера</param>
    /// <param name="status">Ожидаемый код</param>
    /// <param name="substring">Фрагмент причины</param>
    private static async Task AssertRejected(HttpResponseMessage response, HttpStatusCode status, string substring)
    {
        Assert.Equal(status, response.StatusCode);
        var reason = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString();
        Assert.Contains(substring, reason);
    }

    /// <summary>
    /// Некорректные значения свойств: название случая, свойства и фрагмент причины
    /// </summary>
    public static TheoryData<string, object, string> InvalidProperties => new()
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

    /// <summary>
    /// Проверяет, что создание с недопустимым значением свойства отклоняется
    /// </summary>
    /// <param name="_">Название случая</param>
    /// <param name="properties">Свойства объекта</param>
    /// <param name="name">Фрагмент причины</param>
    [Theory]
    [MemberData(nameof(InvalidProperties))]
    public async Task Changeset_CreateWithInvalidPropertyValue_IsRejected(string _, object properties, string name)
    {
        var response = await Apply(_me, Create(Guid.CreateVersion7(), "Item", null, 1, properties));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, name);
        Assert.Empty(await Load(_me));
    }

    /// <summary>
    /// Проверяет, что значения всех видов свойств принимаются
    /// </summary>
    [Fact]
    public async Task Changeset_CreateWithValidValuesOfAllKinds_IsAccepted()
    {
        var folder = Guid.CreateVersion7();
        var response = await Apply(_me,
            Create(folder, "Folder"),
            Create(Guid.CreateVersion7(), "Item", folder, 1, new
            {
                title = "a", body = "b\nc", count = -2, done = true, day = "2026-02-28", at = "09:05",
                level = "low", @ref = folder, folderRef = folder,
            }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// Проверяет, что ссылка на чужой или отсутствующий объект отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_ReferenceToForeignOrMissingObject_IsRejected()
    {
        var foreign = Guid.CreateVersion7();
        await Apply(_other, Create(foreign, "Folder"));

        var toForeign = await Apply(_me, Create(Guid.CreateVersion7(), "Item", null, 1, new { @ref = foreign }));
        var toMissing = await Apply(_me, Create(Guid.CreateVersion7(), "Item", null, 1, new { @ref = Guid.NewGuid() }));

        await AssertRejected(toForeign, HttpStatusCode.UnprocessableEntity, "ref");
        await AssertRejected(toMissing, HttpStatusCode.UnprocessableEntity, "ref");
    }

    /// <summary>
    /// Проверяет, что ссылка на объект недопустимого типа отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_ReferenceToDisallowedType_IsRejected()
    {
        var item = Guid.CreateVersion7();
        var folder = Guid.CreateVersion7();
        await Apply(_me, Create(folder, "Folder"), Create(item, "Item", folder));

        var response = await Apply(_me, Create(Guid.CreateVersion7(), "Item", folder, 2, new { folderRef = item }));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "folderRef");
    }

    /// <summary>
    /// Проверяет, что неизвестный тип отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_UnknownType_IsRejected()
    {
        var response = await Apply(_me, Create(Guid.CreateVersion7(), "Nope"));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "Nope");
    }

    /// <summary>
    /// Проверяет, что объект абстрактного типа создать нельзя
    /// </summary>
    [Fact]
    public async Task Changeset_AbstractType_IsRejected()
    {
        var response = await Apply(_me, Create(Guid.CreateVersion7(), "Base"));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "абстракт");
    }

    /// <summary>
    /// Проверяет, что несуществующий родитель отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_ParentDoesNotExist_IsRejected()
    {
        var response = await Apply(_me, Create(Guid.CreateVersion7(), "Item", Guid.NewGuid()));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "родител");
    }

    /// <summary>
    /// Проверяет, что чужой родитель считается отсутствующим
    /// </summary>
    [Fact]
    public async Task Changeset_ForeignParent_RejectedAsMissing()
    {
        var foreignFolder = Guid.CreateVersion7();
        await Apply(_other, Create(foreignFolder, "Folder"));

        var response = await Apply(_me, Create(Guid.CreateVersion7(), "Item", foreignFolder));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "родител");
        Assert.Empty(await Load(_me));
    }

    /// <summary>
    /// Проверяет, что родитель не принимает дочерний объект недопустимого типа
    /// </summary>
    [Fact]
    public async Task Changeset_ParentDisallowsChildType_IsRejected()
    {
        var item = Guid.CreateVersion7();
        await Apply(_me, Create(item, "Item"));

        var response = await Apply(_me, Create(Guid.CreateVersion7(), "Folder", item));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "Folder");
    }

    /// <summary>
    /// Проверяет, что занятый идентификатор отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_IdAlreadyTaken_IsRejected()
    {
        var id = Guid.CreateVersion7();
        await Apply(_me, Create(id, "Folder"));

        var own = await Apply(_me, Create(id, "Folder"));
        var foreign = await Apply(_other, Create(id, "Folder"));

        await AssertRejected(own, HttpStatusCode.Conflict, "занят");
        await AssertRejected(foreign, HttpStatusCode.Conflict, "занят");
    }

    /// <summary>
    /// Проверяет, что отказ на последней операции отменяет весь набор
    /// </summary>
    [Fact]
    public async Task Changeset_LastOperationRejected_NoneIsApplied()
    {
        var folder = Guid.CreateVersion7();

        var response = await Apply(_me, Create(folder, "Folder"), Create(Guid.CreateVersion7(), "Nope"));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Empty(await Load(_me));
        Assert.Equal(0, await JournalEntryCount());
    }

    /// <summary>
    /// Проверяет, что набор неверного формата отклоняется с причиной
    /// </summary>
    /// <param name="body">Тело запроса</param>
    [Theory]
    [InlineData("{}")]
    [InlineData("""{ "operations": [] }""")]
    [InlineData("""{ "operations": [ { "op": "fly" } ] }""")]
    [InlineData("""{ "operations": [ { "op": "create", "type": "Folder" } ] }""")]
    public async Task Changeset_InvalidFormat_RejectedWithReason(string body)
    {
        var response = await _me.PostAsync("/api/changesets",
            new StringContent(body, System.Text.Encoding.UTF8, "application/json"));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "");
    }

    /// <summary>
    /// Описывает операцию изменения свойств
    /// </summary>
    /// <param name="id">Идентификатор объекта</param>
    /// <param name="changes">Изменения</param>
    /// <returns>Операция набора</returns>
    private static object Update(Guid id, object changes) => new { op = "update", id, changes = changes };

    /// <summary>
    /// Описывает операцию перемещения
    /// </summary>
    /// <param name="id">Идентификатор объекта</param>
    /// <param name="parent">Описание смены родителя</param>
    /// <param name="order">Описание смены порядка</param>
    /// <returns>Операция набора</returns>
    private static object Move(Guid id, object? parent = null, object? order = null) =>
        new { op = "move", id, parent = parent, order = order };

    /// <summary>
    /// Описывает операцию удаления
    /// </summary>
    /// <param name="id">Идентификатор объекта</param>
    /// <returns>Операция набора</returns>
    private static object Delete(Guid id) => new { op = "delete", id };

    /// <summary>
    /// Находит объект по идентификатору
    /// </summary>
    /// <param name="objects">Загруженные объекты</param>
    /// <param name="id">Идентификатор</param>
    /// <returns>JSON объекта</returns>
    private static JsonElement Find(JsonElement[] objects, Guid id) =>
        objects.Single(element => element.GetProperty("id").GetGuid() == id);

    /// <summary>
    /// Проверяет, что изменение с совпавшим старым значением применяется
    /// </summary>
    [Fact]
    public async Task Changeset_UpdateProperty_MatchingOld_IsApplied()
    {
        var id = Guid.CreateVersion7();
        await Apply(_me, Create(id, "Item", null, 1, new { title = "Старое", count = 1 }));

        var response = await Apply(_me, Update(id, new
        {
            title = new { old = "Старое", @new = "Новое" },
            done = new { old = (string?)null, @new = true },
        }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var properties = Find(await Load(_me), id).GetProperty("properties");
        Assert.Equal("Новое", properties.GetProperty("title").GetString());
        Assert.True(properties.GetProperty("done").GetBoolean());
        Assert.Equal(1, properties.GetProperty("count").GetInt32());
    }

    /// <summary>
    /// Проверяет, что новое значение null убирает свойство
    /// </summary>
    [Fact]
    public async Task Changeset_UpdateProperty_NewNull_RemovesValue()
    {
        var id = Guid.CreateVersion7();
        await Apply(_me, Create(id, "Item", null, 1, new { title = "Есть" }));

        var response = await Apply(_me, Update(id, new { title = new { old = "Есть", @new = (string?)null } }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(Find(await Load(_me), id).GetProperty("properties").TryGetProperty("title", out _));
    }

    /// <summary>
    /// Проверяет, что несовпавшее старое значение даёт конфликт и ничего не меняет
    /// </summary>
    [Fact]
    public async Task Changeset_UpdateProperty_OldMismatch_RejectedAsConflictAndChangesNothing()
    {
        var id = Guid.CreateVersion7();
        await Apply(_me, Create(id, "Item", null, 1, new { title = "Текущее", count = 1 }));

        var response = await Apply(_me, Update(id, new
        {
            count = new { old = 1, @new = 2 },
            title = new { old = "Другое", @new = "Новое" },
        }));

        await AssertRejected(response, HttpStatusCode.Conflict, "title");
        var properties = Find(await Load(_me), id).GetProperty("properties");
        Assert.Equal("Текущее", properties.GetProperty("title").GetString());
        Assert.Equal(1, properties.GetProperty("count").GetInt32());
    }

    /// <summary>
    /// Проверяет, что недопустимое новое значение отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_UpdateProperty_InvalidValue_IsRejected()
    {
        var id = Guid.CreateVersion7();
        await Apply(_me, Create(id, "Item", null, 1, new { level = "low" }));

        var response = await Apply(_me, Update(id, new { level = new { old = "low", @new = "medium" } }));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "level");
    }

    /// <summary>
    /// Проверяет, что изменение чужого или отсутствующего объекта отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_UpdateForeignOrMissingObject_IsRejected()
    {
        var foreign = Guid.CreateVersion7();
        await Apply(_other, Create(foreign, "Item", null, 1, new { title = "Секрет" }));

        var toForeign = await Apply(_me, Update(foreign, new { title = new { old = "Секрет", @new = "Взлом" } }));
        var toMissing = await Apply(_me,
            Update(Guid.NewGuid(), new { title = new { old = (string?)null, @new = "x" } }));

        await AssertRejected(toForeign, HttpStatusCode.UnprocessableEntity, "не найден");
        await AssertRejected(toMissing, HttpStatusCode.UnprocessableEntity, "не найден");
        Assert.Equal("Секрет", Find(await Load(_other), foreign).GetProperty("properties").GetProperty("title").GetString());
    }

    /// <summary>
    /// Проверяет, что при отказе второй операции первая откатывается
    /// </summary>
    [Fact]
    public async Task Changeset_FirstOperationValidSecondNot_FirstIsRolledBack()
    {
        var id = Guid.CreateVersion7();
        await Apply(_me, Create(id, "Item", null, 1, new { title = "Исходное" }));

        var response = await Apply(_me,
            Update(id, new { title = new { old = "Исходное", @new = "Изменено" } }),
            Update(id, new { title = new { old = "Исходное", @new = "Опять" } }));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("Исходное", Find(await Load(_me), id).GetProperty("properties").GetProperty("title").GetString());
    }

    /// <summary>
    /// Проверяет, что перемещение меняет родителя и порядок
    /// </summary>
    [Fact]
    public async Task Changeset_Move_ChangesParentAndOrder()
    {
        var first = Guid.CreateVersion7();
        var second = Guid.CreateVersion7();
        var item = Guid.CreateVersion7();
        await Apply(_me, Create(first, "Folder", null, 1), Create(second, "Folder", null, 2), Create(item, "Item", first, 5));

        var response = await Apply(_me, Move(item,
            parent: new { old = first, @new = second }, order: new { old = 5, @new = 1.5 }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var after = Find(await Load(_me), item);
        Assert.Equal(second, after.GetProperty("parent").GetGuid());
        Assert.Equal(1.5, after.GetProperty("order").GetDouble());
    }

    /// <summary>
    /// Проверяет, что перемещение в корень убирает родителя
    /// </summary>
    [Fact]
    public async Task Changeset_MoveToRoot_ClearsParent()
    {
        var folder = Guid.CreateVersion7();
        var nested = Guid.CreateVersion7();
        await Apply(_me, Create(folder, "Folder"), Create(nested, "Folder", folder));

        var response = await Apply(_me, Move(nested, parent: new { old = folder, @new = (Guid?)null }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(JsonValueKind.Null, Find(await Load(_me), nested).GetProperty("parent").ValueKind);
    }

    /// <summary>
    /// Проверяет, что перемещение с неверным прежним положением даёт конфликт
    /// </summary>
    [Fact]
    public async Task Changeset_MoveWithWrongOld_RejectedAsConflict()
    {
        var first = Guid.CreateVersion7();
        var second = Guid.CreateVersion7();
        var folder = Guid.CreateVersion7();
        await Apply(_me, Create(first, "Folder"), Create(second, "Folder"), Create(folder, "Folder", first, 3));

        var wrongParent = await Apply(_me, Move(folder, parent: new { old = second, @new = (Guid?)null }));
        var wrongOrder = await Apply(_me, Move(folder, order: new { old = 99, @new = 1 }));

        await AssertRejected(wrongParent, HttpStatusCode.Conflict, "parent");
        await AssertRejected(wrongOrder, HttpStatusCode.Conflict, "order");
    }

    /// <summary>
    /// Проверяет, что перемещение под недопустимого родителя или в себя отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_MoveUnderInvalidParentOrIntoSelf_IsRejected()
    {
        var folder = Guid.CreateVersion7();
        var nested = Guid.CreateVersion7();
        var item = Guid.CreateVersion7();
        await Apply(_me, Create(folder, "Folder"), Create(nested, "Folder", folder), Create(item, "Item", folder));

        var underItem = await Apply(_me, Move(nested, parent: new { old = folder, @new = item }));
        var intoSelf = await Apply(_me, Move(folder, parent: new { old = (Guid?)null, @new = folder }));
        var intoDescendant = await Apply(_me, Move(folder, parent: new { old = (Guid?)null, @new = nested }));

        await AssertRejected(underItem, HttpStatusCode.UnprocessableEntity, "Folder");
        await AssertRejected(intoSelf, HttpStatusCode.UnprocessableEntity, "цикл");
        await AssertRejected(intoDescendant, HttpStatusCode.UnprocessableEntity, "цикл");
    }

    /// <summary>
    /// Проверяет, что перемещение чужого объекта или под чужого родителя отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_MoveForeignObjectOrUnderForeignParent_IsRejected()
    {
        var foreignFolder = Guid.CreateVersion7();
        var my = Guid.CreateVersion7();
        await Apply(_other, Create(foreignFolder, "Folder"));
        await Apply(_me, Create(my, "Folder"));

        var foreignObject = await Apply(_me, Move(foreignFolder, order: new { old = 1, @new = 2 }));
        var underForeign = await Apply(_me, Move(my, parent: new { old = (Guid?)null, @new = foreignFolder }));

        await AssertRejected(foreignObject, HttpStatusCode.UnprocessableEntity, "не найден");
        await AssertRejected(underForeign, HttpStatusCode.UnprocessableEntity, "родител");
    }

    /// <summary>
    /// Проверяет, что удаляются перечисленные объекты поддерева
    /// </summary>
    [Fact]
    public async Task Changeset_DeleteSubtree_ListedObjectsAreDeleted()
    {
        var folder = Guid.CreateVersion7();
        var item = Guid.CreateVersion7();
        var remaining = Guid.CreateVersion7();
        await Apply(_me, Create(folder, "Folder"), Create(item, "Item", folder), Create(remaining, "Folder"));

        var response = await Apply(_me, Delete(item), Delete(folder));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal([remaining], (await Load(_me)).Select(element => element.GetProperty("id").GetGuid()));
    }

    /// <summary>
    /// Проверяет, что удаление родителя без потомков отклоняется, а потомки неявно не удаляются
    /// </summary>
    [Fact]
    public async Task Changeset_DeleteParentWithoutChildren_RejectedChildrenNotDeletedImplicitly()
    {
        var folder = Guid.CreateVersion7();
        var item = Guid.CreateVersion7();
        await Apply(_me, Create(folder, "Folder"), Create(item, "Item", folder));

        var response = await Apply(_me, Delete(folder));

        await AssertRejected(response, HttpStatusCode.UnprocessableEntity, "потомк");
        Assert.Equal(2, (await Load(_me)).Length);
    }

    /// <summary>
    /// Проверяет, что удаление чужого или отсутствующего объекта отклоняется
    /// </summary>
    [Fact]
    public async Task Changeset_DeleteForeignOrMissing_IsRejected()
    {
        var foreign = Guid.CreateVersion7();
        await Apply(_other, Create(foreign, "Folder"));

        var foreignResponse = await Apply(_me, Delete(foreign));
        var missing = await Apply(_me, Delete(Guid.NewGuid()));

        await AssertRejected(foreignResponse, HttpStatusCode.UnprocessableEntity, "не найден");
        await AssertRejected(missing, HttpStatusCode.UnprocessableEntity, "не найден");
        Assert.Single(await Load(_other));
    }

    /// <summary>
    /// Запись журнала, прочитанная из БД
    /// </summary>
    /// <param name="Operation">Операция</param>
    /// <param name="Property">Свойство</param>
    /// <param name="Old">Прежнее значение</param>
    /// <param name="New">Новое значение</param>
    /// <param name="Snapshot">Снимок объекта</param>
    private sealed record JournalEntry(string Operation, string? Property, JsonElement? Old, JsonElement? New, JsonElement? Snapshot);

    /// <summary>
    /// Читает записи журнала объекта из БД
    /// </summary>
    /// <param name="obj">Идентификатор объекта</param>
    /// <returns>Записи по порядку</returns>
    private async Task<List<JournalEntry>> Journal(Guid obj)
    {
        await using var connection = new NpgsqlConnection(_database);
        return (await Dapper.SqlMapper.QueryAsync<JournalEntry>(connection,
            """
            select operation as Operation, property as Property, old_value as Old, new_value as New, snapshot as Snapshot
            from changeset_entries where object_id = @obj order by id
            """, new { obj })).ToList();
    }

    /// <summary>
    /// Проверяет, что операции набора попадают в журнал со старым и новым значением
    /// </summary>
    [Fact]
    public async Task Journal_ChangesetOperations_AreRecordedWithOldAndNew()
    {
        var first = Guid.CreateVersion7();
        var second = Guid.CreateVersion7();
        var id = Guid.CreateVersion7();
        await Apply(_me, Create(first, "Folder"), Create(second, "Folder"));
        await Apply(_me, Create(id, "Item", first, 1, new { title = "Один" }));
        await Apply(_me, Update(id, new { title = new { old = "Один", @new = "Два" } }));
        await Apply(_me, Move(id, parent: new { old = first, @new = second }));

        var journal = await Journal(id);

        Assert.Equal(["create", "update", "move"], journal.Select(entry => entry.Operation));
        Assert.Equal("Item", journal[0].New!.Value.GetProperty("type").GetString());
        Assert.Equal("Один", journal[0].New!.Value.GetProperty("properties").GetProperty("title").GetString());
        Assert.Equal("title", journal[1].Property);
        Assert.Equal("Один", journal[1].Old!.Value.GetString());
        Assert.Equal("Два", journal[1].New!.Value.GetString());
        Assert.Equal(first, journal[2].Old!.Value.GetProperty("parent").GetGuid());
        Assert.Equal(second, journal[2].New!.Value.GetProperty("parent").GetGuid());
    }

    /// <summary>
    /// Проверяет, что удаление записывает в журнал полный снимок объекта
    /// </summary>
    [Fact]
    public async Task Journal_Delete_StoresFullObjectSnapshot()
    {
        var folder = Guid.CreateVersion7();
        var id = Guid.CreateVersion7();
        await Apply(_me, Create(folder, "Folder"), Create(id, "Item", folder, 4, new { title = "Память", count = 7 }));

        await Apply(_me, Delete(id));

        var entry = (await Journal(id)).Last();
        Assert.Equal("delete", entry.Operation);
        var snapshot = entry.Snapshot!.Value;
        Assert.Equal("Item", snapshot.GetProperty("type").GetString());
        Assert.Equal(folder, snapshot.GetProperty("parent").GetGuid());
        Assert.Equal(4, snapshot.GetProperty("order").GetDouble());
        Assert.Equal("Память", snapshot.GetProperty("properties").GetProperty("title").GetString());
        Assert.Equal(7, snapshot.GetProperty("properties").GetProperty("count").GetInt32());
    }

    /// <summary>
    /// Проверяет, что отклонённый набор не оставляет записей в журнале
    /// </summary>
    [Fact]
    public async Task Journal_RejectedChangeset_LeavesNoTrace()
    {
        await Apply(_me, Delete(Guid.NewGuid()));

        await using var connection = new NpgsqlConnection(_database);
        Assert.Equal(0, await Dapper.SqlMapper.ExecuteScalarAsync<long>(connection, "select count(*) from changesets"));
    }

    /// <summary>
    /// Проверяет, что запись журнала принадлежит автору набора
    /// </summary>
    [Fact]
    public async Task Journal_ChangesetEntry_BelongsToAuthor()
    {
        var response = await Apply(_other, Create(Guid.CreateVersion7(), "Folder"));
        var changeset = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        await using var connection = new NpgsqlConnection(_database);
        var author = await Dapper.SqlMapper.ExecuteScalarAsync<string>(connection,
            "select u.email from changesets c join users u on u.id = c.user_id where c.id = @changeset", new { changeset });
        Assert.Equal(ForeignEmail, author);
    }

    /// <summary>
    /// Проверяет, что БД запрещает изменять и удалять записи журнала
    /// </summary>
    /// <param name="request">SQL-запрос изменения</param>
    [Theory]
    [InlineData("update changeset_entries set new_value = '1'")]
    [InlineData("delete from changeset_entries")]
    [InlineData("update changesets set created_at = now()")]
    [InlineData("delete from changesets")]
    public async Task Journal_UpdateAndDelete_AreForbiddenInDatabase(string request)
    {
        await Apply(_me, Create(Guid.CreateVersion7(), "Folder"));
        await using var connection = new NpgsqlConnection(_database);

        await Assert.ThrowsAsync<PostgresException>(() => Dapper.SqlMapper.ExecuteAsync(connection, request));
    }

    /// <summary>
    /// Считает записи журнала в БД
    /// </summary>
    /// <returns>Число записей</returns>
    private async Task<long> JournalEntryCount()
    {
        await using var connection = new NpgsqlConnection(_database);
        return await Dapper.SqlMapper.ExecuteScalarAsync<long>(connection, "select count(*) from changeset_entries");
    }

    /// <summary>
    /// Проверяет, что без токена объекты недоступны
    /// </summary>
    [Fact]
    public async Task Objects_WithoutToken_Returns401()
    {
        using var anonymous = _server.CreateClient();

        var response = await anonymous.GetAsync("/api/objects");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// Проверяет, что созданные объекты загружаются вместе с данными клиента
    /// </summary>
    [Fact]
    public async Task Changeset_CreateObjects_AppearInLoadWithClientData()
    {
        var folder = Guid.CreateVersion7();
        var item = Guid.CreateVersion7();

        var response = await Apply(_me,
            Create(folder, "Folder", null, 1),
            Create(item, "Item", folder, 2.5, new { title = "Первый", count = 3, done = false, level = "high" }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var objects = await Load(_me);
        Assert.Equal(2, objects.Length);
        var loaded = objects.Single(element => element.GetProperty("id").GetGuid() == item);
        Assert.Equal("Item", loaded.GetProperty("type").GetString());
        Assert.Equal(folder, loaded.GetProperty("parent").GetGuid());
        Assert.Equal(2.5, loaded.GetProperty("order").GetDouble());
        Assert.Equal("Первый", loaded.GetProperty("properties").GetProperty("title").GetString());
        Assert.Equal(3, loaded.GetProperty("properties").GetProperty("count").GetInt32());
        var root = objects.Single(element => element.GetProperty("id").GetGuid() == folder);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("parent").ValueKind);
    }

    /// <summary>
    /// Проверяет, что загрузка возвращает только объекты текущего пользователя
    /// </summary>
    [Fact]
    public async Task Load_ReturnsOnlyCurrentUserObjects()
    {
        var mine = Guid.CreateVersion7();
        var foreign = Guid.CreateVersion7();
        await Apply(_me, Create(mine, "Folder"));
        await Apply(_other, Create(foreign, "Folder"));

        var myObjects = await Load(_me);
        var foreignObjects = await Load(_other);

        Assert.Equal([mine], myObjects.Select(element => element.GetProperty("id").GetGuid()));
        Assert.Equal([foreign], foreignObjects.Select(element => element.GetProperty("id").GetGuid()));
    }
}
