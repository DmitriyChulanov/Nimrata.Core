using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR.Client;
using static Nimrata.Core.Server.Tests.ChangesetApi;
using static Nimrata.Core.Server.Tests.DemoServer;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Push по SignalR: хаб <c>/api/sync</c>, рассылка пакетами по окну, <c>resync</c>
/// </summary>
public sealed class SyncHubTests(ServerFactory factory) : IClassFixture<ServerFactory>, IAsyncLifetime
{
    /// <summary>
    /// Сколько ждём сообщения, которое должно прийти
    /// </summary>
    private static readonly TimeSpan Expected = TimeSpan.FromSeconds(10);

    /// <summary>
    /// Сколько ждём, чтобы убедиться, что сообщения нет (несколько окон рассылки)
    /// </summary>
    private static readonly TimeSpan Silence = TimeSpan.FromMilliseconds(1500);

    // Окно 500 мс: тесты не ждут долго; тесты группировки берут сервер с широким окном
    private readonly DemoServer _server = new(factory, new Dictionary<string, string?>
    {
        ["Sync:PushWindow"] = "00:00:00.500",
        ["Sync:ResyncThreshold"] = "3",
    });

    private readonly List<Tab> _tabs = [];
    private readonly List<DemoServer> _wideServers = [];

    /// <summary>
    /// Поднимает сервер теста
    /// </summary>
    /// <returns>Задача подготовки</returns>
    public Task InitializeAsync() => _server.StartAsync();

    /// <summary>
    /// Закрывает соединения и сервер
    /// </summary>
    /// <returns>Задача освобождения</returns>
    public async Task DisposeAsync()
    {
        foreach (var tab in _tabs)
        {
            await tab.Connection.DisposeAsync();
        }
        await _server.DisposeAsync();
        foreach (var server in _wideServers)
        {
            await server.DisposeAsync();
        }
    }

    /// <summary>
    /// Сервер с широким окном рассылки (3 с): наборы пакета точно попадают в одно окно даже на медленной машине
    /// </summary>
    /// <returns>Запущенный сервер</returns>
    private async Task<DemoServer> StartWideWindowServerAsync()
    {
        var server = new DemoServer(factory, new Dictionary<string, string?>
        {
            ["Sync:PushWindow"] = "00:00:03",
            ["Sync:ResyncThreshold"] = "3",
        });
        _wideServers.Add(server);
        await server.StartAsync();
        return server;
    }

    /// <summary>
    /// Сообщение хаба: имя и полезная нагрузка
    /// </summary>
    /// <param name="Name">Имя метода клиента: <c>changes</c> или <c>resync</c></param>
    /// <param name="Payload">Тело <c>changes</c>; для <c>resync</c> — <c>default</c></param>
    private sealed record Message(string Name, JsonElement Payload);

    /// <summary>
    /// «Вкладка»: соединение с хабом и полученные сообщения
    /// </summary>
    /// <param name="Connection">Соединение</param>
    /// <param name="Messages">Полученные сообщения по порядку</param>
    private sealed record Tab(HubConnection Connection, Channel<Message> Messages)
    {
        /// <summary>
        /// Следующее сообщение
        /// </summary>
        /// <returns>Сообщение; тест падает, если его нет за отведённое время</returns>
        public async Task<Message> NextAsync()
        {
            using var timeout = new CancellationTokenSource(Expected);
            return await Messages.Reader.ReadAsync(timeout.Token);
        }

        /// <summary>
        /// Проверяет, что сообщений нет и не приходит
        /// </summary>
        /// <returns>Задача проверки</returns>
        public async Task AssertSilentAsync()
        {
            await Task.Delay(Silence);
            Assert.False(Messages.Reader.TryRead(out var message), $"Неожиданное сообщение {message?.Name}");
        }
    }

    /// <summary>
    /// Подключает «вкладку» с токеном пользователя
    /// </summary>
    /// <param name="token">Access-токен</param>
    /// <param name="server">Сервер; по умолчанию — общий сервер теста</param>
    /// <returns>Подключённая вкладка</returns>
    private async Task<Tab> ConnectAsync(string token, DemoServer? server = null)
    {
        var connection = (server ?? _server).CreateHubConnection(token);
        var messages = Channel.CreateUnbounded<Message>();
        connection.On<JsonElement>("changes", payload => messages.Writer.TryWrite(new Message("changes", payload)));
        connection.On("resync", () => messages.Writer.TryWrite(new Message("resync", default)));
        await connection.StartAsync();
        var tab = new Tab(connection, messages);
        _tabs.Add(tab);
        return tab;
    }

    /// <summary>
    /// Идентификаторы из JSON-массива строк
    /// </summary>
    /// <param name="array">Массив GUID-строк</param>
    /// <returns>Идентификаторы по порядку</returns>
    private static Guid[] Ids(JsonElement array) => array.EnumerateArray().Select(e => e.GetGuid()).ToArray();

    /// <summary>
    /// Проверяет, что обе вкладки пользователя получают изменение в формате догона
    /// </summary>
    [Fact]
    public async Task Push_TwoTabsOfUser_BothReceiveChangesInCatchUpFormat()
    {
        var first = await ConnectAsync(_server.MeToken);
        var second = await ConnectAsync(_server.MeToken);
        var item = Guid.CreateVersion7();

        var applied = await ApplyAsync(_server.Me, Create(item, "Item", null, "a"));

        foreach (var tab in new[] { first, second })
        {
            var message = await tab.NextAsync();
            Assert.Equal("changes", message.Name);
            Assert.Equal(applied.Seq, message.Payload.GetProperty("toSeq").GetInt64());
            Assert.True(message.Payload.GetProperty("fromSeq").GetInt64() < applied.Seq);
            Assert.Equal([applied.Id], Ids(message.Payload.GetProperty("changesetIds")));
            var upsert = message.Payload.GetProperty("upserts").EnumerateArray().Single();
            Assert.Equal(item, upsert.GetProperty("id").GetGuid());
            Assert.Equal("a", upsert.GetProperty("properties").GetProperty("title").GetString());
            Assert.Empty(Ids(message.Payload.GetProperty("deletes")));
        }
    }

    /// <summary>
    /// Проверяет, что чужой пользователь не получает изменений
    /// </summary>
    [Fact]
    public async Task Push_OtherUser_ReceivesNothing()
    {
        var mine = await ConnectAsync(_server.MeToken);
        var others = await ConnectAsync(_server.OtherToken);

        await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Item", null, "a"));

        Assert.Equal("changes", (await mine.NextAsync()).Name);
        await others.AssertSilentAsync();
    }

    /// <summary>
    /// Проверяет, что наборы, зафиксированные в одном окне, приходят одним сообщением по порядку
    /// </summary>
    [Fact]
    public async Task Push_ChangesetsWithinWindow_AreGroupedIntoOneMessage()
    {
        var server = await StartWideWindowServerAsync();
        var tab = await ConnectAsync(server.MeToken, server);
        var a = Guid.CreateVersion7();
        var b = Guid.CreateVersion7();

        var results = await ApplyManyAsync(
            server.Me,
            (Guid.CreateVersion7(), [Create(a, "Item", null, "a")]),
            (Guid.CreateVersion7(), [Create(b, "Item", null, "b")]));

        var message = await tab.NextAsync();
        Assert.Equal("changes", message.Name);
        Assert.Equal(results.Select(r => r.Id), Ids(message.Payload.GetProperty("changesetIds")));
        Assert.Equal(results[^1].Seq, message.Payload.GetProperty("toSeq").GetInt64());
        Assert.Equal(2, message.Payload.GetProperty("upserts").GetArrayLength());
        await tab.AssertSilentAsync();
    }

    /// <summary>
    /// Проверяет, что следующее окно продолжает с курсора, отправленного в предыдущем
    /// </summary>
    [Fact]
    public async Task Push_NextWindow_ContinuesFromLastSentSeq()
    {
        var tab = await ConnectAsync(_server.MeToken);
        var first = await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Item", null, "a"));
        Assert.Equal([first.Id], Ids((await tab.NextAsync()).Payload.GetProperty("changesetIds")));

        var second = await ApplyAsync(_server.Me, Create(Guid.CreateVersion7(), "Item", null, "b"));

        var message = await tab.NextAsync();
        Assert.Equal([second.Id], Ids(message.Payload.GetProperty("changesetIds")));
        Assert.Equal(first.Seq, message.Payload.GetProperty("fromSeq").GetInt64());
    }

    /// <summary>
    /// Проверяет, что повтор набора (duplicate) ничего не рассылает
    /// </summary>
    [Fact]
    public async Task Push_DuplicateChangeset_SendsNothing()
    {
        var tab = await ConnectAsync(_server.MeToken);
        var id = Guid.CreateVersion7();
        var operations = new[] { Create(Guid.CreateVersion7(), "Item", null, "a") };
        await ApplyManyAsync(_server.Me, (id, operations));
        Assert.Equal("changes", (await tab.NextAsync()).Name);

        await ApplyManyAsync(_server.Me, (id, operations));

        await tab.AssertSilentAsync();
    }

    /// <summary>
    /// Проверяет, что при наборах окна больше порога вместо потока приходит resync
    /// </summary>
    [Fact]
    public async Task Push_MoreChangesetsThanThreshold_SendsResync()
    {
        var server = await StartWideWindowServerAsync();
        var tab = await ConnectAsync(server.MeToken, server);

        await ApplyManyAsync(
            server.Me,
            Enumerable.Range(0, 4)
                .Select(i => (Guid.CreateVersion7(), new[] { Create(Guid.CreateVersion7(), "Item", null, $"{i}") }))
                .ToArray());

        Assert.Equal("resync", (await tab.NextAsync()).Name);
        await tab.AssertSilentAsync();
    }

    /// <summary>
    /// Проверяет, что подключение и отключение расширения рассылаются вкладкам пользователя как resync
    /// </summary>
    /// <param name="connected">Подключить или отключить расширение</param>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Push_ExtensionConnectionChanged_SendsResyncToUserOnly(bool connected)
    {
        var mine = await ConnectAsync(_server.MeToken);
        var others = await ConnectAsync(_server.OtherToken);

        var response = await _server.Me.PutAsJsonAsync("/api/extensions/demo/connection", new { connected });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        Assert.Equal("resync", (await mine.NextAsync()).Name);
        await others.AssertSilentAsync();
    }

    /// <summary>
    /// Проверяет, что хаб без токена недоступен
    /// </summary>
    [Fact]
    public async Task Hub_WithoutToken_IsRejected()
    {
        await using var connection = _server.CreateHubConnection(null);

        await Assert.ThrowsAnyAsync<Exception>(() => connection.StartAsync());
    }

    /// <summary>
    /// Проверяет, что токен из query принимается только для пути хаба, а не для остального API
    /// </summary>
    [Fact]
    public async Task AccessTokenQuery_OutsideHub_IsIgnored()
    {
        using var anonymous = _server.CreateAnonymous();

        var response = await anonymous.GetAsync($"/api/objects?access_token={Uri.EscapeDataString(_server.MeToken)}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
