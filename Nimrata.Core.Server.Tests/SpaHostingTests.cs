using Microsoft.AspNetCore.Hosting;

namespace Nimrata.Core.Server.Tests;

/// <summary>Стенд с собранным «клиентом»: временная папка wwwroot с index.html и статическим файлом</summary>
public sealed class SpaFactory : ServerFactory
{
    public string WebRoot { get; } = Path.Combine(Path.GetTempPath(), "nimrata-wwwroot-" + Guid.NewGuid().ToString("N"));

    public SpaFactory()
    {
        Directory.CreateDirectory(Path.Combine(WebRoot, "assets"));
        File.WriteAllText(Path.Combine(WebRoot, "index.html"), "<html><body>nimrata-spa</body></html>");
        File.WriteAllText(Path.Combine(WebRoot, "assets", "app.js"), "console.log('app');");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseWebRoot(WebRoot);
    }
}

public class SpaHostingTests(SpaFactory factory) : IClassFixture<SpaFactory>
{
    [Fact]
    public async Task RootRoute_ServesClientApp()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/");

        Assert.True(response.IsSuccessStatusCode);
        Assert.Contains("nimrata-spa", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task UnknownClientRoute_FallsBackToClientApp()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/tracker/tasks/42");

        Assert.True(response.IsSuccessStatusCode);
        Assert.Contains("nimrata-spa", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task StaticFile_IsServedAsIs()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/assets/app.js");

        Assert.True(response.IsSuccessStatusCode);
        Assert.Contains("console.log", await response.Content.ReadAsStringAsync());
    }

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

    [Fact]
    public async Task ApiRoutes_WorkAsBefore()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/auth/me");

        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
