using Nimrata.Core.Server.Controllers.Responses;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

public class AdminUsersTests(ServerFactory factory) : IClassFixture<ServerFactory>
{
    private record UserDto(Guid Id, string Email, string Name, string Role, bool IsActive);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static HttpClient NewClient(ServerFactory factory) => factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

    private static async Task<HttpClient> Authorize(HttpClient client, string email, string password)
    {
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password = password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private Task<HttpClient> AsAdministrator() =>
        Authorize(NewClient(factory), ServerFactory.AdminEmail, ServerFactory.AdminPassword);

    private static string UniqueEmail() => $"u{Guid.NewGuid():N}@example.test";

    private static async Task<UserDto> Create(HttpClient admin, string email, string role = "member", string password = "password-1234")
    {
        var response = await admin.PostAsJsonAsync("/api/admin/users", new { email, name = "Имя " + email, password = password, role = role });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<UserDto>(Json))!;
    }

    private static async Task<string> ReasonOf(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("detail").GetString()!;
    }

    [Fact]
    public async Task Member_OnAdminEndpoints_Gets403()
    {
        using var admin = await AsAdministrator();
        var email = UniqueEmail();
        var user = await Create(admin, email);
        using var member = await Authorize(NewClient(factory), email, "password-1234");

        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/api/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await member.PostAsJsonAsync("/api/admin/users", new { email = UniqueEmail(), name = "x", password = "password-1234", role = "member" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await member.PutAsJsonAsync($"/api/admin/users/{user.Id}/role", new { role = "admin" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsync($"/api/admin/users/{user.Id}/disable", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsync($"/api/admin/users/{user.Id}/enable", null)).StatusCode);
    }

    [Fact]
    public async Task WithoutToken_Returns401()
    {
        using var client = NewClient(factory);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/admin/users")).StatusCode);
    }

    [Fact]
    public async Task Administrator_CreatesUser_UserCanLoginAndAppearsInList()
    {
        using var admin = await AsAdministrator();
        var email = UniqueEmail();

        var created = await Create(admin, email);

        Assert.Equal("member", created.Role);
        Assert.True(created.IsActive);
        var list = await admin.GetFromJsonAsync<List<UserDto>>("/api/admin/users", Json);
        Assert.Contains(list!, u => u.Id == created.Id && u.Email == email && u.Role == "member");
        Assert.Contains(list!, u => u.Email == ServerFactory.AdminEmail && u.Role == "admin");
        using var _ = await Authorize(NewClient(factory), email, "password-1234");
    }

    [Fact]
    public async Task Create_RejectsShortPasswordDuplicateAndInvalidRole()
    {
        using var admin = await AsAdministrator();
        var email = UniqueEmail();

        var tooShort = await admin.PostAsJsonAsync("/api/admin/users", new { email, name = "x", password = "short", role = "member" });
        Assert.Equal(HttpStatusCode.BadRequest, tooShort.StatusCode);
        Assert.Contains("8", await ReasonOf(tooShort));

        var role = await admin.PostAsJsonAsync("/api/admin/users", new { email, name = "x", password = "password-1234", role = "boss" });
        Assert.Equal(HttpStatusCode.BadRequest, role.StatusCode);

        var blankEmail = await admin.PostAsJsonAsync("/api/admin/users", new { email = " ", name = "x", password = "password-1234", role = "member" });
        Assert.Equal(HttpStatusCode.BadRequest, blankEmail.StatusCode);

        await Create(admin, email);
        var duplicate = await admin.PostAsJsonAsync("/api/admin/users", new { email = email.ToUpperInvariant(), name = "x", password = "password-1234", role = "member" });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }

    [Fact]
    public async Task ChangeRole_PromotesAndDemotes()
    {
        using var admin = await AsAdministrator();
        var user = await Create(admin, UniqueEmail());

        var promotion = await admin.PutAsJsonAsync($"/api/admin/users/{user.Id}/role", new { role = "admin" });
        Assert.Equal(HttpStatusCode.NoContent, promotion.StatusCode);
        var demotion = await admin.PutAsJsonAsync($"/api/admin/users/{user.Id}/role", new { role = "member" });
        Assert.Equal(HttpStatusCode.NoContent, demotion.StatusCode);

        var list = await admin.GetFromJsonAsync<List<UserDto>>("/api/admin/users", Json);
        Assert.Equal("member", list!.Single(u => u.Id == user.Id).Role);
    }

    [Fact]
    public async Task UnknownUser_Returns404()
    {
        using var admin = await AsAdministrator();
        var id = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"/api/admin/users/{id}/disable", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"/api/admin/users/{id}/role", new { role = "member" })).StatusCode);
    }

    [Fact]
    public async Task LastAdministrator_CannotBeDisabledOrDemoted_WithClearReason()
    {
        // отдельный стенд: в общей базе другие тесты заводят администраторов
        await using var separate = new ServerFactory();
        await ((IAsyncLifetime)separate).InitializeAsync();
        using var admin = await Authorize(NewClient(separate), ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        var list = await admin.GetFromJsonAsync<List<UserDto>>("/api/admin/users", Json);
        var only = list!.Single(u => u.Role == "admin");

        var disable = await admin.PostAsync($"/api/admin/users/{only.Id}/disable", null);
        Assert.Equal(HttpStatusCode.Conflict, disable.StatusCode);
        Assert.Contains("администратор", await ReasonOf(disable), StringComparison.OrdinalIgnoreCase);

        var demotion = await admin.PutAsJsonAsync($"/api/admin/users/{only.Id}/role", new { role = "member" });
        Assert.Equal(HttpStatusCode.Conflict, demotion.StatusCode);
        Assert.Contains("администратор", await ReasonOf(demotion), StringComparison.OrdinalIgnoreCase);

        // со вторым администратором операции разрешены
        var second = await Create(admin, UniqueEmail(), "admin");
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/users/{second.Id}/disable", null)).StatusCode);
        // отключённый администратор не считается: единственный действующий снова защищён
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/admin/users/{only.Id}/disable", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/users/{second.Id}/enable", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await admin.PutAsJsonAsync($"/api/admin/users/{only.Id}/role", new { role = "member" })).StatusCode);
    }

    [Fact]
    public async Task Disable_BlocksLoginAndRevokesRefresh_EnableRestoresLogin()
    {
        using var admin = await AsAdministrator();
        var email = UniqueEmail();
        var user = await Create(admin, email);
        using var client = NewClient(factory);
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password = "password-1234" });
        var cookie = login.Headers.GetValues("Set-Cookie").First(v => v.StartsWith("refresh_token=")).Split(';')[0];

        var disable = await admin.PostAsync($"/api/admin/users/{user.Id}/disable", null);
        Assert.Equal(HttpStatusCode.NoContent, disable.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/auth/login", new { email, password = "password-1234" })).StatusCode);
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        request.Headers.Add("Cookie", cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(request)).StatusCode);
        await using (var connection = new NpgsqlConnection(factory.ConnectionString))
        {
            var notRevoked = await connection.ExecuteScalarAsync<int>(
                "select count(*) from refresh_tokens where user_id = @id and revoked_at is null", new { id = user.Id });
            Assert.Equal(0, notRevoked);
        }

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/users/{user.Id}/enable", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await client.PostAsJsonAsync("/api/auth/login", new { email, password = "password-1234" })).StatusCode);
    }
}
