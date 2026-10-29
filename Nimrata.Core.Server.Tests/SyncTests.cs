using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using static Nimrata.Core.Server.Tests.ChangesetApi;
using static Nimrata.Core.Server.Tests.DemoServer;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Догон <c>GET /api/changes</c> и согласованная полная загрузка <c>GET /api/snapshot</c>
/// </summary>
public sealed class SyncTests(ServerFactory factory) : IClassFixture<ServerFactory>, IAsyncLifetime
{
    private readonly DemoServer _server = new(factory, new Dictionary<string, string?> { ["Sync:ResyncThreshold"] = "3" });

    /// <summary>
    /// Поднимает сервер теста с порогом resync 3
    /// </summary>
    /// <returns>Задача подготовки</returns>
    public Task InitializeAsync() => _server.StartAsync();

    /// <summary>
    /// Освобождает сервер теста
    /// </summary>
    /// <returns>Задача освобождения</returns>
    public Task DisposeAsync() => _server.DisposeAsync().AsTask();

    /// <summary>
    /// Догон администратора с курсора
    /// </summary>
    /// <param name="since">Курсор клиента</param>
    /// <returns>Тело ответа 200</returns>
    private async Task<JsonElement> ChangesAsync(long since)
    {
        var response = await _server.Me.GetAsync($"/api/changes?since={since}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    /// <summary>
    /// Идентификаторы из JSON-массива строк
    /// </summary>
    /// <param name="array">Массив GUID-строк</param>
    /// <returns>Идентификаторы по порядку</returns>
    private static Guid[] Ids(JsonElement array) => array.EnumerateArray().Select(e => e.GetGuid()).ToArray();

    /// <summary>
    /// Идентификаторы объектов из JSON-массива объектов
    /// </summary>
    /// <param name="array">Массив объектов с полем <c>id</c></param>
    /// <returns>Идентификаторы по порядку</returns>
    private static Guid[] ObjectIds(JsonElement array) =>
        array.EnumerateArray().Select(e => e.GetProperty("id").GetGuid()).ToArray();

    /// <summary>
    /// Проверяет, что догон с нуля отдаёт наборы по порядку, курсор последнего и финальное состояние объектов
    /// </summary>
    [Fact]
    public async Task Changes_FromZero_ReturnsChangesetsInOrderAndFinalState()
    {
        var item = Guid.CreateVersion7();
        var first = await ApplyAsync(_server.Me, Create(item, "Item", null, "a"));
        var second = await ApplyAsync(_server.Me, new { op = "update", id = item, changes = new { title = new { @new = "b" } } });

        var changes = await ChangesAsync(0);

        Assert.Equal(second.Seq, changes.GetProperty("toSeq").GetInt64());
        Assert.Equal([first.Id, second.Id], Ids(changes.GetProperty("changesetIds")));
        var upsert = changes.GetProperty("upserts").EnumerateArray().Single();
        Assert.Equal(item, upsert.GetProperty("id").GetGuid());
        Assert.Equal("Item", upsert.GetProperty("type").GetString());
        Assert.Equal("b", upsert.GetProperty("properties").GetProperty("title").GetString());
        Assert.Empty(Ids(changes.GetProperty("deletes")));
        Assert.False(changes.TryGetProperty("resync", out _));
    }

    /// <summary>
    /// Проверяет, что догон отдаёт только изменения после курсора, а удалённые объекты — в deletes
    /// </summary>
    [Fact]
    public async Task Changes_SinceCursor_OnlyLaterChangesAndDeletes()
    {
        var (kept, removed, added) = (Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7());
        var cursor = (await ApplyAsync(_server.Me, Create(kept, "Folder"), Create(removed, "Folder"))).Seq!.Value;
        await ApplyAsync(_server.Me, new { op = "delete", id = removed });
        var last = await ApplyAsync(_server.Me, Create(added, "Folder"));

        var changes = await ChangesAsync(cursor);

        Assert.Equal(last.Seq, changes.GetProperty("toSeq").GetInt64());
        Assert.Equal([added], ObjectIds(changes.GetProperty("upserts")));
        Assert.Equal([removed], Ids(changes.GetProperty("deletes")));
        Assert.Equal(2, changes.GetProperty("changesetIds").GetArrayLength());
    }

    /// <summary>
    /// Проверяет, что без новых наборов догон пуст, а курсор остаётся прежним
    /// </summary>
    [Fact]
    public async Task Changes_NothingNew_EmptyWithSameCursor()
    {
        var cursor = (await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"))).Seq!.Value;

        var changes = await ChangesAsync(cursor);

        Assert.Equal(cursor, changes.GetProperty("toSeq").GetInt64());
        Assert.Equal(0, changes.GetProperty("changesetIds").GetArrayLength());
        Assert.Equal(0, changes.GetProperty("upserts").GetArrayLength());
        Assert.Equal(0, changes.GetProperty("deletes").GetArrayLength());
    }

    /// <summary>
    /// Проверяет, что пользователь без наборов получает пустой догон с курсором 0
    /// </summary>
    [Fact]
    public async Task Changes_UserWithoutChangesets_ZeroCursor()
    {
        var changes = await ChangesAsync(0);

        Assert.Equal(0, changes.GetProperty("toSeq").GetInt64());
        Assert.Equal(0, changes.GetProperty("changesetIds").GetArrayLength());
    }

    /// <summary>
    /// Проверяет, что чужие наборы и объекты в догон не попадают
    /// </summary>
    [Fact]
    public async Task Changes_ForeignChangesets_NotIncluded()
    {
        var mine = await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"));
        await ApplyAsync(_server.Other, Create(Guid.CreateVersion7(), "Folder"));

        var changes = await ChangesAsync(0);

        Assert.Equal([mine.Id], Ids(changes.GetProperty("changesetIds")));
        Assert.Single(changes.GetProperty("upserts").EnumerateArray());
        Assert.Equal(mine.Seq, changes.GetProperty("toSeq").GetInt64());
    }

    /// <summary>
    /// Проверяет, что больше порога наборов после курсора дают resync вместо потока изменений
    /// </summary>
    [Fact]
    public async Task Changes_MoreThanThreshold_Resync()
    {
        for (var i = 0; i < 4; i++)
        {
            AssertApplied(await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder")));
        }

        var changes = await ChangesAsync(0);

        Assert.True(changes.GetProperty("resync").GetBoolean());
        Assert.False(changes.TryGetProperty("upserts", out _));
    }

    /// <summary>
    /// Проверяет, что ровно порог наборов ещё отдаётся потоком изменений
    /// </summary>
    [Fact]
    public async Task Changes_ExactlyThreshold_NoResync()
    {
        for (var i = 0; i < 3; i++)
        {
            AssertApplied(await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder")));
        }

        var changes = await ChangesAsync(0);

        Assert.Equal(3, changes.GetProperty("changesetIds").GetArrayLength());
    }

    /// <summary>
    /// Проверяет, что курсор новее последнего набора пользователя (например, БД пересоздана) даёт resync
    /// </summary>
    [Fact]
    public async Task Changes_CursorAheadOfServer_Resync()
    {
        var last = await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"));

        var changes = await ChangesAsync(last.Seq!.Value + 100);

        Assert.True(changes.GetProperty("resync").GetBoolean());
    }

    /// <summary>
    /// Проверяет, что объекты отключённого расширения в upserts не попадают и уходят в deletes
    /// </summary>
    [Fact]
    public async Task Changes_DisabledExtension_ObjectsHidden()
    {
        var folder = Guid.CreateVersion7();
        await ApplyAsync(_server.Me, Create(folder, "Folder"));
        (await _server.Me.PutAsJsonAsync("/api/extensions/demo/connection", new { connected = false })).EnsureSuccessStatusCode();

        var changes = await ChangesAsync(0);

        Assert.Equal(0, changes.GetProperty("upserts").GetArrayLength());
        Assert.Equal([folder], Ids(changes.GetProperty("deletes")));
    }

    /// <summary>
    /// Проверяет, что неверный курсор даёт 400
    /// </summary>
    /// <param name="query">Строка запроса</param>
    [Theory]
    [InlineData("")]
    [InlineData("?since=-1")]
    [InlineData("?since=abc")]
    public async Task Changes_InvalidCursor_Returns400(string query)
    {
        var response = await _server.Me.GetAsync("/api/changes" + query);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// Проверяет, что без токена догон и загрузка недоступны
    /// </summary>
    /// <param name="path">Маршрут</param>
    [Theory]
    [InlineData("/api/changes?since=0")]
    [InlineData("/api/snapshot")]
    public async Task Sync_WithoutToken_Returns401(string path)
    {
        using var anonymous = _server.CreateAnonymous();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
    }

    /// <summary>
    /// Проверяет, что полная загрузка отдаёт объекты, типы и seq последнего набора пользователя
    /// </summary>
    [Fact]
    public async Task Snapshot_ReturnsObjectsTypesAndSeq()
    {
        var folder = Guid.CreateVersion7();
        await ApplyAsync(_server.Me, Create(folder, "Folder"));
        var last = await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Item", folder, "x"));
        await ApplyAsync(_server.Other, Create(Guid.CreateVersion7(), "Folder"));

        var snapshot = await _server.Me.GetFromJsonAsync<JsonElement>("/api/snapshot");

        Assert.Equal(last.Seq, snapshot.GetProperty("seq").GetInt64());
        Assert.Equal(2, snapshot.GetProperty("objects").GetArrayLength());
        var types = snapshot.GetProperty("types").EnumerateArray().Select(t => t.GetProperty("id").GetString()).ToArray();
        Assert.Contains("Folder", types);
        Assert.Contains("SettingsRoot", types);
        Assert.Equal("demo", snapshot.GetProperty("types").EnumerateArray()
            .Single(t => t.GetProperty("id").GetString() == "Folder").GetProperty("extension").GetString());
    }

    /// <summary>
    /// Проверяет, что после загрузки догон с её seq ничего не повторяет
    /// </summary>
    [Fact]
    public async Task Snapshot_SeqAsCursor_ChangesEmpty()
    {
        await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"));
        var snapshot = await _server.Me.GetFromJsonAsync<JsonElement>("/api/snapshot");

        var changes = await ChangesAsync(snapshot.GetProperty("seq").GetInt64());

        Assert.Equal(0, changes.GetProperty("changesetIds").GetArrayLength());
    }

    /// <summary>
    /// Проверяет, что загрузка нового пользователя пуста и с курсором 0
    /// </summary>
    [Fact]
    public async Task Snapshot_NewUser_EmptyWithZeroSeq()
    {
        var snapshot = await _server.Other.GetFromJsonAsync<JsonElement>("/api/snapshot");

        Assert.Equal(0, snapshot.GetProperty("seq").GetInt64());
        Assert.Equal(0, snapshot.GetProperty("objects").GetArrayLength());
    }

    /// <summary>
    /// Проверяет, что загрузка скрывает объекты отключённого расширения, как <c>GET objects</c>
    /// </summary>
    [Fact]
    public async Task Snapshot_DisabledExtension_ObjectsHidden()
    {
        await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"));
        (await _server.Me.PutAsJsonAsync("/api/extensions/demo/connection", new { connected = false })).EnsureSuccessStatusCode();

        var snapshot = await _server.Me.GetFromJsonAsync<JsonElement>("/api/snapshot");

        Assert.Equal(0, snapshot.GetProperty("objects").GetArrayLength());
    }
}
