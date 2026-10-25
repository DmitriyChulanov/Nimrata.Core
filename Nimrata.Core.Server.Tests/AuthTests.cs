using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Dapper;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

public record TokenResponse(string AccessToken);

public class AuthTests(ServerFactory фабрика) : IClassFixture<ServerFactory>
{
    private HttpClient Клиент() => фабрика.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

    private static string? Cookie(HttpResponseMessage ответ, string имя) =>
        ответ.Headers.TryGetValues("Set-Cookie", out var значения)
            ? значения.FirstOrDefault(v => v.StartsWith(имя + "="))
            : null;

    /// <summary>Пара «имя=значение» из Set-Cookie для заголовка Cookie следующего запроса.</summary>
    private static string ЗаголовокCookie(string setCookie) => setCookie.Split(';')[0];

    private static async Task<HttpResponseMessage> Войти(HttpClient клиент, string email, string пароль) =>
        await клиент.PostAsJsonAsync("/api/auth/login", new { email, password = пароль });

    private static Task<HttpResponseMessage> Запрос(HttpClient клиент, string путь, string? cookie)
    {
        var запрос = new HttpRequestMessage(HttpMethod.Post, путь);
        if (cookie is not null) запрос.Headers.Add("Cookie", cookie);
        return клиент.SendAsync(запрос);
    }

    [Fact]
    public async Task Вход_СверномПаролем_ВыдаётAccessИRefreshВHttpOnlyCookie()
    {
        using var клиент = Клиент();

        var ответ = await Войти(клиент, ServerFactory.AdminEmail, ServerFactory.AdminPassword);

        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
        var токен = await ответ.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.False(string.IsNullOrEmpty(токен!.AccessToken));
        var cookie = Cookie(ответ, "refresh_token");
        Assert.NotNull(cookie);
        Assert.Contains("httponly", cookie!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Вход_СНевернымПаролем_Возвращает401БезCookie()
    {
        using var клиент = Клиент();

        var ответ = await Войти(клиент, ServerFactory.AdminEmail, "неверный-пароль");

        Assert.Equal(HttpStatusCode.Unauthorized, ответ.StatusCode);
        Assert.Null(Cookie(ответ, "refresh_token"));
    }

    [Fact]
    public async Task Вход_СНеизвестнымEmail_Возвращает401()
    {
        using var клиент = Клиент();

        var ответ = await Войти(клиент, "nobody@example.test", "какой-то-пароль");

        Assert.Equal(HttpStatusCode.Unauthorized, ответ.StatusCode);
    }

    [Fact]
    public async Task ЗащищённоеApi_БезТокена401_СТокеномОтвечает()
    {
        using var клиент = Клиент();
        Assert.Equal(HttpStatusCode.Unauthorized, (await клиент.GetAsync("/api/auth/me")).StatusCode);

        var вход = await Войти(клиент, ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        var токен = (await вход.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        клиент.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", токен);

        var ответ = await клиент.GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
        Assert.Contains(ServerFactory.AdminEmail, await ответ.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Refresh_ПоCookie_ВыдаётНовыйAccessИМеняетRefresh()
    {
        using var клиент = Клиент();
        var вход = await Войти(клиент, ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        var cookie = ЗаголовокCookie(Cookie(вход, "refresh_token")!);

        var ответ = await Запрос(клиент, "/api/auth/refresh", cookie);

        Assert.Equal(HttpStatusCode.OK, ответ.StatusCode);
        var токен = await ответ.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.False(string.IsNullOrEmpty(токен!.AccessToken));
        var новая = Cookie(ответ, "refresh_token");
        Assert.NotNull(новая);
        Assert.NotEqual(cookie, ЗаголовокCookie(новая!));
        // старый refresh после ротации больше не принимается
        Assert.Equal(HttpStatusCode.Unauthorized, (await Запрос(клиент, "/api/auth/refresh", cookie)).StatusCode);
    }

    [Fact]
    public async Task Refresh_БезCookie_Возвращает401()
    {
        using var клиент = Клиент();

        var ответ = await Запрос(клиент, "/api/auth/refresh", null);

        Assert.Equal(HttpStatusCode.Unauthorized, ответ.StatusCode);
    }

    [Fact]
    public async Task Выход_ОтзываетRefresh()
    {
        using var клиент = Клиент();
        var вход = await Войти(клиент, ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        var cookie = ЗаголовокCookie(Cookie(вход, "refresh_token")!);

        var выход = await Запрос(клиент, "/api/auth/logout", cookie);

        Assert.Equal(HttpStatusCode.NoContent, выход.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Запрос(клиент, "/api/auth/refresh", cookie)).StatusCode);
    }

    [Fact]
    public async Task ОтключённыйПользователь_НеМожетВойтиИОбновитьТокен()
    {
        const string email = "disabled@example.test";
        const string пароль = "disabled-password";
        await СоздатьПользователя(email, пароль);
        using var клиент = Клиент();
        var вход = await Войти(клиент, email, пароль);
        Assert.Equal(HttpStatusCode.OK, вход.StatusCode);
        var cookie = ЗаголовокCookie(Cookie(вход, "refresh_token")!);

        await using (var соединение = new NpgsqlConnection(фабрика.ConnectionString))
        {
            await соединение.ExecuteAsync("update users set is_active = false where email = @email", new { email });
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await Войти(клиент, email, пароль)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Запрос(клиент, "/api/auth/refresh", cookie)).StatusCode);
    }

    [Fact]
    public async Task ПервыйАдминистратор_ПриПовторномЗапуске_НеДублируется()
    {
        using var второйЗапуск = фабрика.WithWebHostBuilder(_ => { });
        using var клиент = второйЗапуск.CreateClient();
        await клиент.GetAsync("/health");

        await using var соединение = new NpgsqlConnection(фабрика.ConnectionString);
        var число = await соединение.ExecuteScalarAsync<int>(
            "select count(*) from users where email = @email", new { email = ServerFactory.AdminEmail });
        Assert.Equal(1, число);
        var вход = await Войти(клиент, ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        Assert.Equal(HttpStatusCode.OK, вход.StatusCode);
    }

    [Fact]
    public void ПервыйАдминистратор_СКороткимПаролем_ЗапускПадает()
    {
        using var плохая = фабрика.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) =>
            c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Admin:Email"] = "short@example.test",
                ["Admin:Password"] = "short",
            })));

        Assert.ThrowsAny<Exception>(() => плохая.CreateClient());
    }

    /// <summary>Создаёт пользователя тем же способом, что и сид администратора: запуском сервера с другими настройками.</summary>
    private async Task СоздатьПользователя(string email, string пароль)
    {
        using var запуск = фабрика.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) =>
            c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Admin:Email"] = email,
                ["Admin:Password"] = пароль,
            })));
        using var клиент = запуск.CreateClient();
        await клиент.GetAsync("/health");
    }
}
