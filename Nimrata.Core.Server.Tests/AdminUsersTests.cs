using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

public class AdminUsersTests(ServerFactory фабрика) : IClassFixture<ServerFactory>
{
    private record UserDto(Guid Id, string Email, string Name, string Role, bool IsActive);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static HttpClient Клиент(ServerFactory ф) => ф.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

    private static async Task<HttpClient> Авторизованный(HttpClient клиент, string email, string пароль)
    {
        var вход = await клиент.PostAsJsonAsync("/api/auth/login", new { email, password = пароль });
        Assert.Equal(HttpStatusCode.OK, вход.StatusCode);
        var токен = (await вход.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        клиент.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", токен);
        return клиент;
    }

    private Task<HttpClient> КакАдминистратор() =>
        Авторизованный(Клиент(фабрика), ServerFactory.AdminEmail, ServerFactory.AdminPassword);

    private static string Уникальный() => $"u{Guid.NewGuid():N}@example.test";

    private static async Task<UserDto> Создать(HttpClient админ, string email, string роль = "member", string пароль = "password-1234")
    {
        var ответ = await админ.PostAsJsonAsync("/api/admin/users", new { email, name = "Имя " + email, password = пароль, role = роль });
        Assert.Equal(HttpStatusCode.Created, ответ.StatusCode);
        return (await ответ.Content.ReadFromJsonAsync<UserDto>(Json))!;
    }

    private static async Task<string> Причина(HttpResponseMessage ответ)
    {
        using var док = JsonDocument.Parse(await ответ.Content.ReadAsStringAsync());
        return док.RootElement.GetProperty("error").GetString()!;
    }

    [Fact]
    public async Task Участник_НаЭндпоинтахАдминистрирования_Получает403()
    {
        using var админ = await КакАдминистратор();
        var email = Уникальный();
        var пользователь = await Создать(админ, email);
        using var участник = await Авторизованный(Клиент(фабрика), email, "password-1234");

        Assert.Equal(HttpStatusCode.Forbidden, (await участник.GetAsync("/api/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await участник.PostAsJsonAsync("/api/admin/users", new { email = Уникальный(), name = "x", password = "password-1234", role = "member" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await участник.PutAsJsonAsync($"/api/admin/users/{пользователь.Id}/role", new { role = "admin" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await участник.PostAsync($"/api/admin/users/{пользователь.Id}/disable", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await участник.PostAsync($"/api/admin/users/{пользователь.Id}/enable", null)).StatusCode);
    }

    [Fact]
    public async Task БезТокена_Возвращает401()
    {
        using var клиент = Клиент(фабрика);
        Assert.Equal(HttpStatusCode.Unauthorized, (await клиент.GetAsync("/api/admin/users")).StatusCode);
    }

    [Fact]
    public async Task Администратор_СоздаётПользователя_ОнВходитИВидитсяВСписке()
    {
        using var админ = await КакАдминистратор();
        var email = Уникальный();

        var созданный = await Создать(админ, email);

        Assert.Equal("member", созданный.Role);
        Assert.True(созданный.IsActive);
        var список = await админ.GetFromJsonAsync<List<UserDto>>("/api/admin/users", Json);
        Assert.Contains(список!, u => u.Id == созданный.Id && u.Email == email && u.Role == "member");
        Assert.Contains(список!, u => u.Email == ServerFactory.AdminEmail && u.Role == "admin");
        using var _ = await Авторизованный(Клиент(фабрика), email, "password-1234");
    }

    [Fact]
    public async Task Создание_ОтклоняетКороткийПарольДубльИНевернуюРоль()
    {
        using var админ = await КакАдминистратор();
        var email = Уникальный();

        var короткий = await админ.PostAsJsonAsync("/api/admin/users", new { email, name = "x", password = "short", role = "member" });
        Assert.Equal(HttpStatusCode.BadRequest, короткий.StatusCode);
        Assert.Contains("8", await Причина(короткий));

        var роль = await админ.PostAsJsonAsync("/api/admin/users", new { email, name = "x", password = "password-1234", role = "boss" });
        Assert.Equal(HttpStatusCode.BadRequest, роль.StatusCode);

        var пустойEmail = await админ.PostAsJsonAsync("/api/admin/users", new { email = " ", name = "x", password = "password-1234", role = "member" });
        Assert.Equal(HttpStatusCode.BadRequest, пустойEmail.StatusCode);

        await Создать(админ, email);
        var дубль = await админ.PostAsJsonAsync("/api/admin/users", new { email = email.ToUpperInvariant(), name = "x", password = "password-1234", role = "member" });
        Assert.Equal(HttpStatusCode.Conflict, дубль.StatusCode);
    }

    [Fact]
    public async Task СменаРоли_ПовышаетИПонижает()
    {
        using var админ = await КакАдминистратор();
        var пользователь = await Создать(админ, Уникальный());

        var повышение = await админ.PutAsJsonAsync($"/api/admin/users/{пользователь.Id}/role", new { role = "admin" });
        Assert.Equal(HttpStatusCode.NoContent, повышение.StatusCode);
        var понижение = await админ.PutAsJsonAsync($"/api/admin/users/{пользователь.Id}/role", new { role = "member" });
        Assert.Equal(HttpStatusCode.NoContent, понижение.StatusCode);

        var список = await админ.GetFromJsonAsync<List<UserDto>>("/api/admin/users", Json);
        Assert.Equal("member", список!.Single(u => u.Id == пользователь.Id).Role);
    }

    [Fact]
    public async Task НеизвестныйПользователь_Возвращает404()
    {
        using var админ = await КакАдминистратор();
        var id = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.NotFound, (await админ.PostAsync($"/api/admin/users/{id}/disable", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await админ.PutAsJsonAsync($"/api/admin/users/{id}/role", new { role = "member" })).StatusCode);
    }

    [Fact]
    public async Task ПоследнегоАдминистратора_НельзяОтключитьИПонизить_СПонятнойПричиной()
    {
        // отдельный стенд: в общей базе другие тесты заводят администраторов
        await using var отдельная = new ServerFactory();
        await ((IAsyncLifetime)отдельная).InitializeAsync();
        using var админ = await Авторизованный(Клиент(отдельная), ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        var список = await админ.GetFromJsonAsync<List<UserDto>>("/api/admin/users", Json);
        var единственный = список!.Single(u => u.Role == "admin");

        var отключение = await админ.PostAsync($"/api/admin/users/{единственный.Id}/disable", null);
        Assert.Equal(HttpStatusCode.Conflict, отключение.StatusCode);
        Assert.Contains("администратор", await Причина(отключение), StringComparison.OrdinalIgnoreCase);

        var понижение = await админ.PutAsJsonAsync($"/api/admin/users/{единственный.Id}/role", new { role = "member" });
        Assert.Equal(HttpStatusCode.Conflict, понижение.StatusCode);
        Assert.Contains("администратор", await Причина(понижение), StringComparison.OrdinalIgnoreCase);

        // со вторым администратором операции разрешены
        var второй = await Создать(админ, Уникальный(), "admin");
        Assert.Equal(HttpStatusCode.NoContent, (await админ.PostAsync($"/api/admin/users/{второй.Id}/disable", null)).StatusCode);
        // отключённый администратор не считается: единственный действующий снова защищён
        Assert.Equal(HttpStatusCode.Conflict, (await админ.PostAsync($"/api/admin/users/{единственный.Id}/disable", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await админ.PostAsync($"/api/admin/users/{второй.Id}/enable", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await админ.PutAsJsonAsync($"/api/admin/users/{единственный.Id}/role", new { role = "member" })).StatusCode);
    }

    [Fact]
    public async Task Отключение_ЗапрещаетВходИОтзываетRefresh_ВключениеВозвращаетВход()
    {
        using var админ = await КакАдминистратор();
        var email = Уникальный();
        var пользователь = await Создать(админ, email);
        using var клиент = Клиент(фабрика);
        var вход = await клиент.PostAsJsonAsync("/api/auth/login", new { email, password = "password-1234" });
        var cookie = вход.Headers.GetValues("Set-Cookie").First(v => v.StartsWith("refresh_token=")).Split(';')[0];

        var отключение = await админ.PostAsync($"/api/admin/users/{пользователь.Id}/disable", null);
        Assert.Equal(HttpStatusCode.NoContent, отключение.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await клиент.PostAsJsonAsync("/api/auth/login", new { email, password = "password-1234" })).StatusCode);
        var запрос = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        запрос.Headers.Add("Cookie", cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await клиент.SendAsync(запрос)).StatusCode);
        await using (var соединение = new NpgsqlConnection(фабрика.ConnectionString))
        {
            var неотозванные = await соединение.ExecuteScalarAsync<int>(
                "select count(*) from refresh_tokens where user_id = @id and revoked_at is null", new { id = пользователь.Id });
            Assert.Equal(0, неотозванные);
        }

        Assert.Equal(HttpStatusCode.NoContent, (await админ.PostAsync($"/api/admin/users/{пользователь.Id}/enable", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await клиент.PostAsJsonAsync("/api/auth/login", new { email, password = "password-1234" })).StatusCode);
    }
}
