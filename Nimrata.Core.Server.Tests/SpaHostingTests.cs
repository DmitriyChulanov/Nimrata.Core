using Microsoft.AspNetCore.Hosting;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Стенд с собранным «клиентом»: временная папка wwwroot с index.html и статическим файлом
/// </summary>
public sealed class SpaFactory : ServerFactory
{
    /// <summary>
    /// Временная папка wwwroot стенда
    /// </summary>
    public string WebRoot { get; } = Path.Combine(Path.GetTempPath(), "nimrata-wwwroot-" + Guid.NewGuid().ToString("N"));

    /// <summary>
    /// Создаёт временный wwwroot с index.html, статическим файлом и service worker
    /// </summary>
    public SpaFactory()
    {
        Directory.CreateDirectory(Path.Combine(WebRoot, "assets"));
        File.WriteAllText(Path.Combine(WebRoot, "index.html"), "<html><body>nimrata-spa</body></html>");
        File.WriteAllText(Path.Combine(WebRoot, "assets", "app.js"), "console.log('app');");
        File.WriteAllText(Path.Combine(WebRoot, "sw.js"), "self.skipWaiting();");
        File.WriteAllText(Path.Combine(WebRoot, "registerSW.js"), "navigator.serviceWorker.register('/sw.js');");
    }

    /// <summary>
    /// Подставляет временный wwwroot вместо настоящего
    /// </summary>
    /// <param name="builder">Построитель веб-хоста</param>
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseWebRoot(WebRoot);
    }
}

/// <summary>
/// Раздача клиентского приложения и его маршрутов
/// </summary>
/// <param name="factory">Стенд с собранным клиентом</param>
public class SpaHostingTests(SpaFactory factory) : IClassFixture<SpaFactory>
{
    /// <summary>
    /// Проверяет, что корневой маршрут отдаёт клиентское приложение
    /// </summary>
    [Fact]
    public async Task RootRoute_ServesClientApp()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/");

        Assert.True(response.IsSuccessStatusCode);
        Assert.Contains("nimrata-spa", await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// Проверяет, что неизвестный клиентский маршрут отдаёт клиентское приложение
    /// </summary>
    [Fact]
    public async Task UnknownClientRoute_FallsBackToClientApp()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/tracker/tasks/42");

        Assert.True(response.IsSuccessStatusCode);
        Assert.Contains("nimrata-spa", await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// Проверяет, что статический файл отдаётся как есть
    /// </summary>
    [Fact]
    public async Task StaticFile_IsServedAsIs()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/assets/app.js");

        Assert.True(response.IsSuccessStatusCode);
        Assert.Contains("console.log", await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// Проверяет, что неизвестный маршрут API не подменяется клиентом
    /// </summary>
    /// <param name="path">Путь запроса</param>
    [Theory]
    [InlineData("/api/нет-такого")]
    [InlineData("/api/auth/нет-такого")]
    public async Task UnknownApiRoute_IsNotReplacedByClientAndFails(string path)
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path);

        Assert.False(response.IsSuccessStatusCode);
        Assert.DoesNotContain("nimrata-spa", await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// Проверяет, что маршруты API работают как раньше
    /// </summary>
    [Fact]
    public async Task ApiRoutes_WorkAsBefore()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/auth/me");

        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// Проверяет, что service worker, его регистрация и оболочка не кэшируются браузером без проверки:
    /// иначе новая версия приложения не подхватится
    /// </summary>
    /// <param name="path">Путь запроса</param>
    [Theory]
    [InlineData("/sw.js")]
    [InlineData("/registerSW.js")]
    [InlineData("/")]
    [InlineData("/index.html")]
    [InlineData("/tracker/tasks/42")]
    public async Task ServiceWorkerAndShell_AreRevalidatedOnEveryRequest(string path)
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path);

        Assert.True(response.IsSuccessStatusCode);
        Assert.True(response.Headers.CacheControl?.NoCache, $"Cache-Control для {path}: {response.Headers.CacheControl}");
    }

    /// <summary>
    /// Проверяет, что service worker отдаётся как скрипт: иначе браузер его не зарегистрирует
    /// </summary>
    [Fact]
    public async Task ServiceWorker_IsServedAsJavaScript()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/sw.js");

        Assert.Equal("text/javascript", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("skipWaiting", await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// Проверяет, что ассеты с хэшем в имени кэшируются надолго: их содержимое под тем же именем не меняется
    /// </summary>
    [Fact]
    public async Task HashedAssets_AreCachedAsImmutable()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/assets/app.js");

        Assert.True(response.Headers.CacheControl?.Public);
        Assert.Equal(TimeSpan.FromDays(365), response.Headers.CacheControl?.MaxAge);
        Assert.Contains("immutable", response.Headers.CacheControl?.ToString());
    }
}
