using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using static Nimrata.Core.Server.Tests.ChangesetApi;
using static Nimrata.Core.Server.Tests.DemoServer;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Пакетная запись наборов: независимость наборов, идемпотентность по id, курсор seq, порядок фиксации, LWW
/// </summary>
public sealed class ChangesetBatchTests(ServerFactory factory) : IClassFixture<ServerFactory>, IAsyncLifetime
{
    private readonly DemoServer _server = new(factory);

    /// <summary>
    /// Поднимает сервер теста
    /// </summary>
    /// <returns>Задача подготовки</returns>
    public Task InitializeAsync() => _server.StartAsync();

    /// <summary>
    /// Освобождает сервер теста
    /// </summary>
    /// <returns>Задача освобождения</returns>
    public Task DisposeAsync() => _server.DisposeAsync().AsTask();

    /// <summary>
    /// Проверяет, что наборы пакета применяются независимо: отказ одного не откатывает соседние, результаты по порядку
    /// </summary>
    [Fact]
    public async Task Batch_OneChangesetRejected_OthersApplied()
    {
        var (first, second, third) = (Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7());
        var (a, c) = (Guid.CreateVersion7(), Guid.CreateVersion7());

        var results = await ApplyManyAsync(_server.Me,
            (first, [Create(a, "Folder")]),
            (second, [Create(Guid.CreateVersion7(), "Nope")]),
            (third, [Create(c, "Folder")]));

        Assert.Equal([first, second, third], results.Select(r => r.Id));
        AssertApplied(results[0]);
        AssertRejected(results[1], "Nope");
        AssertApplied(results[2]);
        Assert.True(results[0].Seq < results[2].Seq);
        var ids = (await _server.Me.GetFromJsonAsync<JsonElement[]>("/api/objects"))!
            .Select(o => o.GetProperty("id").GetGuid()).Order();
        Assert.Equal(new[] { a, c }.Order(), ids);
    }

    /// <summary>
    /// Проверяет, что набор сохраняется в журнале под идентификатором клиента
    /// </summary>
    [Fact]
    public async Task Batch_AppliedChangeset_StoredUnderClientId()
    {
        var id = Guid.CreateVersion7();

        var result = (await ApplyManyAsync(_server.Me, (id, [Create(Guid.CreateVersion7(), "Folder")]))).Single();

        AssertApplied(result);
        await using var connection = new NpgsqlConnection(_server.Database);
        Assert.Equal(result.Seq, await connection.ExecuteScalarAsync<long?>("select seq from changesets where id = @id", new { id }));
    }

    /// <summary>
    /// Проверяет, что повтор известного набора не применяется заново и возвращает прежний seq
    /// </summary>
    [Fact]
    public async Task Batch_RepeatedId_DuplicateWithSameSeqAndNotReapplied()
    {
        var id = Guid.CreateVersion7();
        var folder = Guid.CreateVersion7();
        var first = (await ApplyManyAsync(_server.Me, (id, [Create(folder, "Folder")]))).Single();

        var again = (await ApplyManyAsync(_server.Me, (id, [Create(folder, "Folder")]))).Single();

        AssertApplied(first);
        Assert.Equal("duplicate", again.Status);
        Assert.Equal(first.Seq, again.Seq);
        await using var connection = new NpgsqlConnection(_server.Database);
        Assert.Equal(1, await connection.ExecuteScalarAsync<long>("select count(*) from changesets"));
    }

    /// <summary>
    /// Проверяет, что повтор набора внутри одного пакета тоже распознаётся как повтор
    /// </summary>
    [Fact]
    public async Task Batch_SameIdTwiceInOneRequest_SecondIsDuplicate()
    {
        var id = Guid.CreateVersion7();
        var folder = Guid.CreateVersion7();

        var results = await ApplyManyAsync(_server.Me, (id, [Create(folder, "Folder")]), (id, [Create(folder, "Folder")]));

        AssertApplied(results[0]);
        Assert.Equal("duplicate", results[1].Status);
        Assert.Equal(results[0].Seq, results[1].Seq);
    }

    /// <summary>
    /// Проверяет, что идентификатор чужого набора не выдаёт его результат и не применяется
    /// </summary>
    [Fact]
    public async Task Batch_IdOfForeignChangeset_Rejected()
    {
        var id = Guid.CreateVersion7();
        AssertApplied((await ApplyManyAsync(_server.Other, (id, [Create(Guid.CreateVersion7(), "Folder")]))).Single());

        var mine = (await ApplyManyAsync(_server.Me, (id, [Create(Guid.CreateVersion7(), "Folder")]))).Single();

        AssertRejected(mine, "занят", "invalid_data");
        Assert.Empty((await _server.Me.GetFromJsonAsync<JsonElement[]>("/api/objects"))!);
    }

    /// <summary>
    /// Проверяет, что отклонённый набор не запоминается: исправленный повтор с тем же id применяется
    /// </summary>
    [Fact]
    public async Task Batch_RejectedThenResentWithSameId_IsApplied()
    {
        var id = Guid.CreateVersion7();
        var parent = Guid.CreateVersion7();
        var child = Guid.CreateVersion7();
        AssertRejected((await ApplyManyAsync(_server.Me, (id, [Create(child, "Item", parent)]))).Single(), "родител");

        AssertApplied((await ApplyManyAsync(_server.Me, (Guid.CreateVersion7(), [Create(parent, "Folder")]))).Single());
        var resent = (await ApplyManyAsync(_server.Me, (id, [Create(child, "Item", parent)]))).Single();

        AssertApplied(resent);
    }

    /// <summary>
    /// Проверяет, что ошибки формата пакета дают 400, а не результат по наборам
    /// </summary>
    /// <param name="body">Тело запроса</param>
    [Theory]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("""{ "changesets": {} }""")]
    [InlineData("""{ "changesets": [ 1 ] }""")]
    [InlineData("""{ "changesets": [ { "operations": [ { "op": "delete", "id": "00000000-0000-4000-8000-000000000001" } ] } ] }""")]
    [InlineData("""{ "changesets": [ { "id": "abc", "operations": [ { "op": "delete", "id": "00000000-0000-4000-8000-000000000001" } ] } ] }""")]
    [InlineData("""{ "changesets": [ { "id": "00000000-0000-4000-8000-000000000001" } ] }""")]
    [InlineData("""{ "changesets": [ { "id": "00000000-0000-4000-8000-000000000001", "operations": [] } ] }""")]
    [InlineData("""{ "operations": [ { "op": "delete", "id": "00000000-0000-4000-8000-000000000001" } ] }""")]
    public async Task Batch_InvalidFormat_Returns400(string body)
    {
        var response = await _server.Me.PostAsync(
            "/api/changesets", new StringContent(body, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    /// <summary>
    /// Проверяет, что содержимое операций проверяется по набору: неизвестная операция — отказ набора, а не 400
    /// </summary>
    [Fact]
    public async Task Batch_UnknownOperation_RejectsOnlyThatChangeset()
    {
        var result = await ApplyAsync(_server.Me, new { op = "fly" });

        AssertRejected(result, "fly");
    }

    /// <summary>
    /// Проверяет, что без токена пакет не принимается
    /// </summary>
    [Fact]
    public async Task Batch_WithoutToken_Returns401()
    {
        using var anonymous = _server.CreateAnonymous();

        var response = await anonymous.PostAsJsonAsync("/api/changesets", new { changesets = Array.Empty<object>() });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// Проверяет, что seq растёт от набора к набору
    /// </summary>
    [Fact]
    public async Task Seq_GrowsWithEachAppliedChangeset()
    {
        var first = await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"));
        var second = await ApplyAsync(_server.Other, Create(Guid.CreateVersion7(), "Folder"));
        var third = await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"));

        Assert.True(first.Seq > 0);
        Assert.True(second.Seq > first.Seq);
        Assert.True(third.Seq > second.Seq);
    }

    /// <summary>
    /// Проверяет, что prevSeq указывает на предыдущий набор того же пользователя, а не на соседний глобальный seq
    /// </summary>
    [Fact]
    public async Task PrevSeq_ChangesetsOfOtherUserInBetween_PointsToOwnPreviousChangeset()
    {
        var first = await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"));
        var foreign = await ApplyAsync(_server.Other, Create(Guid.CreateVersion7(), "Folder"));

        var second = await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"));

        Assert.Equal(0, first.PrevSeq);
        Assert.Equal(0, foreign.PrevSeq);
        Assert.Equal(first.Seq, second.PrevSeq);
        Assert.True(second.Seq > foreign.Seq);
    }

    /// <summary>
    /// Проверяет, что повтор набора возвращает тот же prevSeq, что и первое применение, даже после новых наборов
    /// </summary>
    [Fact]
    public async Task PrevSeq_Duplicate_SameAsOnFirstApply()
    {
        var id = Guid.CreateVersion7();
        var folder = Guid.CreateVersion7();
        await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"));
        var first = (await ApplyManyAsync(_server.Me, (id, [Create(folder, "Folder")]))).Single();
        await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"));

        var again = (await ApplyManyAsync(_server.Me, (id, [Create(folder, "Folder")]))).Single();

        Assert.Equal("duplicate", again.Status);
        Assert.Equal(first.PrevSeq, again.PrevSeq);
    }

    /// <summary>
    /// Проверяет, что набор, который БД не принимает (символ U+0000 в jsonb, SQLSTATE 22P05), отклоняется
    /// с кодом invalid_data, а не даёт 5xx, и соседние наборы пакета применяются
    /// </summary>
    [Fact]
    public async Task Batch_DataRejectedByDatabase_RejectedWithCodeOthersApplied()
    {
        var (poison, good) = (Guid.CreateVersion7(), Guid.CreateVersion7());

        var results = await ApplyManyAsync(_server.Me,
            (poison, [Create(Guid.CreateVersion7(), "Item", null, "a\u0000b")]),
            (good, [Create(Guid.CreateVersion7(), "Folder")]));

        AssertRejected(results[0], "22P05", "invalid_data");
        AssertApplied(results[1]);
        await using var connection = new NpgsqlConnection(_server.Database);
        Assert.Equal(0, await connection.ExecuteScalarAsync<long>(
            "select count(*) from changesets where id = @poison", new { poison }));
    }

    /// <summary>
    /// Проверяет, что набор пользователя ждёт фиксации предыдущего: порядок seq совпадает с порядком фиксации,
    /// а курсор не проскакивает незафиксированный набор с меньшим seq
    /// </summary>
    [Fact]
    public async Task Seq_ConcurrentChangesetsOfUser_CommitInSeqOrder()
    {
        var item = Guid.CreateVersion7();
        AssertApplied(await ApplyAsync(_server.Me, Create(item, "Item", null, "a")));
        var cursor = (await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"))).Seq!.Value;

        // Держим строку объекта: первый набор получит seq и остановится на ней
        await using var holder = new NpgsqlConnection(_server.Database);
        await holder.OpenAsync();
        await using var hold = await holder.BeginTransactionAsync();
        await holder.ExecuteAsync("select 1 from objects where id = @item for update", new { item }, hold);

        var slow = ApplyAsync(_server.Me, new { op = "update", id = item, changes = new { title = new { @new = "b" } } });
        await WaitForLockWaitersAsync(1);
        var fast = ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Folder"));
        await WaitForLockWaitersAsync(2);

        // Пока первый не зафиксирован, второй не фиксируется, и догон ничего нового не видит
        Assert.False(fast.IsCompleted);
        var during = await _server.Me.GetFromJsonAsync<JsonElement>($"/api/changes?since={cursor}");
        Assert.Equal(cursor, during.GetProperty("toSeq").GetInt64());

        await hold.CommitAsync();
        var (slowResult, fastResult) = (await slow, await fast);
        AssertApplied(slowResult);
        AssertApplied(fastResult);
        Assert.True(slowResult.Seq < fastResult.Seq);
    }

    /// <summary>
    /// Ждёт, пока в БД теста не окажется нужное число сеансов, ожидающих блокировку
    /// </summary>
    /// <param name="count">Сколько сеансов должно ждать блокировку</param>
    /// <returns>Задача ожидания; тест падает, если не дождались</returns>
    private async Task WaitForLockWaitersAsync(int count)
    {
        await using var connection = new NpgsqlConnection(_server.Database);
        for (var attempt = 0; attempt < 200; attempt++)
        {
            var waiting = await connection.ExecuteScalarAsync<long>(
                "select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'");
            if (waiting >= count) return;
            await Task.Delay(25);
        }
        Assert.Fail($"Не дождались {count} ожидающих блокировку сеансов.");
    }

    /// <summary>
    /// Проверяет LWW для свойства: «было» не сверяется, в журнал пишется фактическое прежнее значение
    /// </summary>
    [Fact]
    public async Task Lww_UpdateWithStaleOld_AppliedAndJournalHasActualOld()
    {
        var item = Guid.CreateVersion7();
        AssertApplied(await ApplyAsync(_server.Me, Create(item, "Item", null, "текущее")));

        var result = await ApplyAsync(_server.Me,
            new { op = "update", id = item, changes = new { title = new { old = "устаревшее", @new = "новое" } } });

        AssertApplied(result);
        Assert.Equal("новое", (await LoadAsync(item)).GetProperty("properties").GetProperty("title").GetString());
        Assert.Equal("\"текущее\"", await JournalOldAsync(item, "update"));
    }

    /// <summary>
    /// Проверяет, что «было» в изменении свойства необязательно
    /// </summary>
    [Fact]
    public async Task Lww_UpdateWithoutOld_Applied()
    {
        var item = Guid.CreateVersion7();
        AssertApplied(await ApplyAsync(_server.Me, Create(item, "Item", null, "a")));

        var result = await ApplyAsync(_server.Me, new { op = "update", id = item, changes = new { title = new { @new = "b" } } });

        AssertApplied(result);
        Assert.Equal("\"a\"", await JournalOldAsync(item, "update"));
    }

    /// <summary>
    /// Проверяет LWW для перемещения: устаревшие parent и number не мешают, журнал хранит фактическое положение
    /// </summary>
    [Fact]
    public async Task Lww_MoveWithStaleOld_AppliedAndJournalHasActualOld()
    {
        var (first, second, item) = (Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7());
        AssertApplied(await ApplyAsync(_server.Me, Create(first, "Folder"), Create(second, "Folder"), Create(item, "Item", first)));

        var result = await ApplyAsync(_server.Me, new
        {
            op = "move",
            id = item,
            parent = new { old = (Guid?)null, @new = second },
            number = new { old = 42, @new = 3 },
        });

        AssertApplied(result);
        var moved = await LoadAsync(item);
        Assert.Equal(second, moved.GetProperty("parent").GetGuid());
        Assert.Equal(3, moved.GetProperty("number").GetInt32());
        var old = JsonDocument.Parse((await JournalOldAsync(item, "move"))!).RootElement;
        Assert.Equal(first, old.GetProperty("parent").GetGuid());
        Assert.Equal(1, old.GetProperty("number").GetInt32());
    }

    /// <summary>
    /// Проверяет, что перемещение без «было» тоже применяется
    /// </summary>
    [Fact]
    public async Task Lww_MoveWithoutOld_Applied()
    {
        var item = Guid.CreateVersion7();
        AssertApplied(await ApplyAsync(_server.Me, Create(item, "Folder")));

        var result = await ApplyAsync(_server.Me, new { op = "move", id = item, number = new { @new = 7 } });

        AssertApplied(result);
        Assert.Equal(7, (await LoadAsync(item)).GetProperty("number").GetInt32());
    }

    /// <summary>
    /// Читает объект пользователя через API
    /// </summary>
    /// <param name="id">Идентификатор объекта</param>
    /// <returns>JSON объекта</returns>
    private async Task<JsonElement> LoadAsync(Guid id) =>
        (await _server.Me.GetFromJsonAsync<JsonElement[]>("/api/objects"))!.Single(o => o.GetProperty("id").GetGuid() == id);

    /// <summary>
    /// Прежнее значение последней записи журнала объекта с указанной операцией, в виде JSON
    /// </summary>
    /// <param name="objectId">Объект записи</param>
    /// <param name="operation">Операция записи: <c>update</c>, <c>move</c></param>
    /// <returns>Текст jsonb прежнего значения; <c>null</c> — записи или значения нет</returns>
    private async Task<string?> JournalOldAsync(Guid objectId, string operation)
    {
        await using var connection = new NpgsqlConnection(_server.Database);
        return await connection.ExecuteScalarAsync<string?>(
            "select old_value::text from changeset_entries where object_id = @objectId and operation = @operation order by id desc limit 1",
            new { objectId, operation });
    }
}
