using Nimrata.Core.Server.Controllers.Responses;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Dapper;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

public class AuthTests(ServerFactory factory) : IClassFixture<ServerFactory>
{
    private HttpClient NewClient() => factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

    private static string? Cookie(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.FirstOrDefault(v => v.StartsWith(name + "="))
            : null;

    /// <summary>Пара «имя=значение» из Set-Cookie для заголовка Cookie следующего запроса</summary>
    private static string CookieHeader(string setCookie) => setCookie.Split(';')[0];

    private static async Task<HttpResponseMessage> Login(HttpClient client, string email, string password) =>
        await client.PostAsJsonAsync("/api/auth/login", new { email, password = password });

    private static Task<HttpResponseMessage> Request(HttpClient client, string path, string? cookie)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path);
        if (cookie is not null) request.Headers.Add("Cookie", cookie);
        return client.SendAsync(request);
    }

    [Fact]
    public async Task Login_WithCorrectPassword_IssuesAccessAndHttpOnlyRefreshCookie()
    {
        using var client = NewClient();

        var response = await Login(client, ServerFactory.AdminEmail, ServerFactory.AdminPassword);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var token = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.False(string.IsNullOrEmpty(token!.AccessToken));
        var cookie = Cookie(response, "refresh_token");
        Assert.NotNull(cookie);
        Assert.Contains("httponly", cookie!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Login_WithWrongPassword_Returns401WithoutCookie()
    {
        using var client = NewClient();

        var response = await Login(client, ServerFactory.AdminEmail, "неверный-пароль");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Null(Cookie(response, "refresh_token"));
    }

    [Fact]
    public async Task Login_WithUnknownEmail_Returns401()
    {
        using var client = NewClient();

        var response = await Login(client, "nobody@example.test", "какой-то-пароль");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ProtectedApi_WithoutToken401_WithTokenResponds()
    {
        using var client = NewClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);

        var login = await Login(client, ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(ServerFactory.AdminEmail, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Refresh_WithCookie_IssuesNewAccessAndRotatesRefresh()
    {
        using var client = NewClient();
        var login = await Login(client, ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        var cookie = CookieHeader(Cookie(login, "refresh_token")!);

        var response = await Request(client, "/api/auth/refresh", cookie);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var token = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.False(string.IsNullOrEmpty(token!.AccessToken));
        var rotatedCookie = Cookie(response, "refresh_token");
        Assert.NotNull(rotatedCookie);
        Assert.NotEqual(cookie, CookieHeader(rotatedCookie!));
        // старый refresh после ротации больше не принимается
        Assert.Equal(HttpStatusCode.Unauthorized, (await Request(client, "/api/auth/refresh", cookie)).StatusCode);
    }

    [Fact]
    public async Task Refresh_WithoutCookie_Returns401()
    {
        using var client = NewClient();

        var response = await Request(client, "/api/auth/refresh", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Logout_RevokesRefresh()
    {
        using var client = NewClient();
        var login = await Login(client, ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        var cookie = CookieHeader(Cookie(login, "refresh_token")!);

        var logout = await Request(client, "/api/auth/logout", cookie);

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Request(client, "/api/auth/refresh", cookie)).StatusCode);
    }

    [Fact]
    public async Task DisabledUser_CannotLoginOrRefreshToken()
    {
        const string email = "disabled@example.test";
        const string password = "disabled-password";
        await CreateUserAsync(email, password);
        using var client = NewClient();
        var login = await Login(client, email, password);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var cookie = CookieHeader(Cookie(login, "refresh_token")!);

        await using (var connection = new NpgsqlConnection(factory.ConnectionString))
        {
            await connection.ExecuteAsync("update users set is_active = false where email = @email", new { email });
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(client, email, password)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Request(client, "/api/auth/refresh", cookie)).StatusCode);
    }

    [Fact]
    public async Task FirstAdministrator_OnRestart_IsNotDuplicated()
    {
        using var secondStart = factory.WithWebHostBuilder(_ => { });
        using var client = secondStart.CreateClient();
        await client.GetAsync("/health");

        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        var count = await connection.ExecuteScalarAsync<int>(
            "select count(*) from users where email = @email", new { email = ServerFactory.AdminEmail });
        Assert.Equal(1, count);
        var login = await Login(client, ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public void FirstAdministrator_WithShortPassword_StartupFails()
    {
        using var bad = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) =>
            c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Admin:Email"] = "short@example.test",
                ["Admin:Password"] = "short",
            })));

        Assert.ThrowsAny<Exception>(() => bad.CreateClient());
    }

    /// <summary>Создаёт пользователя тем же способом, что и сид администратора: запуском сервера с другими настройками</summary>
    private async Task CreateUserAsync(string email, string password)
    {
        using var start = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) =>
            c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Admin:Email"] = email,
                ["Admin:Password"] = password,
            })));
        using var client = start.CreateClient();
        await client.GetAsync("/health");
    }
}
