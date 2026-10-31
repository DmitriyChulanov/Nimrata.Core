namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Проверка секции настроек <c>Sync</c> при старте сервера
/// </summary>
public sealed class SyncOptionsTests(ServerFactory factory) : IClassFixture<ServerFactory>
{
    /// <summary>
    /// Проверяет, что недопустимые значения секции <c>Sync</c> не дают серверу стартовать
    /// </summary>
    /// <param name="key">Настройка</param>
    /// <param name="value">Недопустимое значение</param>
    [Theory]
    [InlineData("Sync:ResyncThreshold", "0")]
    [InlineData("Sync:PushWindow", "00:00:00")]
    public async Task Start_InvalidSyncSetting_Fails(string key, string value)
    {
        await using var server = new DemoServer(factory, new Dictionary<string, string?> { [key] = value });

        var error = await Assert.ThrowsAnyAsync<Exception>(server.StartAsync);

        Assert.Contains(key.Split(':')[1], error.ToString());
    }
}
