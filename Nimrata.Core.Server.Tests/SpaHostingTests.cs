using Microsoft.AspNetCore.Hosting;

namespace Nimrata.Core.Server.Tests;

/// <summary>Стенд с собранным «клиентом»: временная папка wwwroot с index.html и статическим файлом.</summary>
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

public class SpaHostingTests(SpaFactory фабрика) : IClassFixture<SpaFactory>
{
    [Fact]
    public async Task КорневойМаршрут_ОтдаётКлиентскоеПриложение()
    {
        using var клиент = фабрика.CreateClient();

        var ответ = await клиент.GetAsync("/");

        Assert.True(ответ.IsSuccessStatusCode);
        Assert.Contains("nimrata-spa", await ответ.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task НеизвестныйМаршрутКлиента_ПереключаетсяНаКлиентскоеПриложение()
    {
        using var клиент = фабрика.CreateClient();

        var ответ = await клиент.GetAsync("/tracker/tasks/42");

        Assert.True(ответ.IsSuccessStatusCode);
        Assert.Contains("nimrata-spa", await ответ.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task СтатическийФайл_ОтдаётсяКакЕсть()
    {
        using var клиент = фабрика.CreateClient();

        var ответ = await клиент.GetAsync("/assets/app.js");

        Assert.True(ответ.IsSuccessStatusCode);
        Assert.Contains("console.log", await ответ.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("/api/нет-такого")]
    [InlineData("/api/auth/нет-такого")]
    public async Task НеизвестныйМаршрутApi_НеПодменяетсяКлиентомИДаётНеУспех(string путь)
    {
        using var клиент = фабрика.CreateClient();

        var ответ = await клиент.GetAsync(путь);

        Assert.False(ответ.IsSuccessStatusCode);
        Assert.DoesNotContain("nimrata-spa", await ответ.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task МаршрутыApi_РаботаютКакПрежде()
    {
        using var клиент = фабрика.CreateClient();

        var ответ = await клиент.GetAsync("/api/auth/me");

        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, ответ.StatusCode);
    }
}
