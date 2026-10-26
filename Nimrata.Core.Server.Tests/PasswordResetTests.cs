using Nimrata.Core.Server.Controllers.Responses;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Сброс пароля по e-mail: HTTP API с поддельной почтой (фабрика с Postgres в Testcontainers)
/// </summary>
public class PasswordResetTests(ServerFactory factory) : IClassFixture<ServerFactory>
{
    /// <summary>
    /// Пользователь в ответе API
    /// </summary>
    /// <param name="Id">Идентификатор</param>
    /// <param name="Email">Адрес</param>
    private record UserDto(Guid Id, string Email);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Создаёт клиент без автоматической обработки cookie
    /// </summary>
    /// <returns>Клиент HTTP</returns>
    private HttpClient NewClient() => factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

    /// <summary>
    /// Формирует уникальный адрес
    /// </summary>
    /// <returns>Новый адрес</returns>
    private static string UniqueEmail() => $"r{Guid.NewGuid():N}@example.test";

    /// <summary>
    /// Создаёт клиент, вошедший как администратор
    /// </summary>
    /// <returns>Клиент администратора</returns>
    private async Task<HttpClient> Administrator()
    {
        var client = NewClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email = ServerFactory.AdminEmail, password = ServerFactory.AdminPassword });
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    /// <summary>
    /// Создаёт пользователя через API администратора
    /// </summary>
    /// <param name="email">Адрес</param>
    /// <param name="password">Пароль</param>
    /// <returns>Созданный пользователь</returns>
    private async Task<UserDto> CreateUserAsync(string email, string password = "old-password-1")
    {
        using var admin = await Administrator();
        var response = await admin.PostAsJsonAsync("/api/admin/users", new { email, name = "Имя", password = password, role = "member" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<UserDto>(Json))!;
    }

    /// <summary>
    /// Достаёт токен из ссылки в письме
    /// </summary>
    /// <param name="email">Письмо</param>
    /// <returns>Токен</returns>
    private static string TokenFromEmail(Auth.EmailMessage email) =>
        Uri.UnescapeDataString(Regex.Match(email.Body, @"token=([^\s]+)").Groups[1].Value);

    /// <summary>
    /// Находит последнее письмо, отправленное на адрес
    /// </summary>
    /// <param name="email">Адрес получателя</param>
    /// <returns>Письмо или null</returns>
    private Auth.EmailMessage? LastEmail(string email) =>
        factory.Mailbox.Emails.LastOrDefault(mail => mail.To == email);

    /// <summary>
    /// Запрашивает ссылку сброса пароля
    /// </summary>
    /// <param name="client">Клиент HTTP</param>
    /// <param name="email">Адрес</param>
    /// <returns>Ответ сервера</returns>
    private static Task<HttpResponseMessage> RequestReset(HttpClient client, string email) =>
        client.PostAsJsonAsync("/api/auth/forgot-password", new { email });

    /// <summary>
    /// Устанавливает новый пароль по токену
    /// </summary>
    /// <param name="client">Клиент HTTP</param>
    /// <param name="token">Токен из письма</param>
    /// <param name="password">Новый пароль</param>
    /// <returns>Ответ сервера</returns>
    private static Task<HttpResponseMessage> Confirm(HttpClient client, string token, string password) =>
        client.PostAsJsonAsync("/api/auth/reset-password", new { token = token, password = password });

    /// <summary>
    /// Отправляет запрос входа
    /// </summary>
    /// <param name="client">Клиент HTTP</param>
    /// <param name="email">Адрес</param>
    /// <param name="password">Пароль</param>
    /// <returns>Ответ сервера</returns>
    private static Task<HttpResponseMessage> Login(HttpClient client, string email, string password) =>
        client.PostAsJsonAsync("/api/auth/login", new { email, password = password });

    /// <summary>
    /// Проверяет, что ответ одинаков для известного и неизвестного адреса, а письмо уходит только существующему пользователю
    /// </summary>
    [Fact]
    public async Task Request_ForKnownAndUnknownEmail_RespondsSameAndMailsOnlyExistingUser()
    {
        var email = UniqueEmail();
        await CreateUserAsync(email);
        using var client = NewClient();

        var known = await RequestReset(client, email);
        var unknown = await RequestReset(client, "nobody-" + UniqueEmail());

        Assert.Equal(known.StatusCode, unknown.StatusCode);
        Assert.Equal(await known.Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());
        Assert.NotNull(LastEmail(email));
        Assert.DoesNotContain(factory.Mailbox.Emails, mail => mail.To.StartsWith("nobody-"));
        Assert.Contains("https://nimrata.test/reset-password?token=", LastEmail(email)!.Body);
    }

    /// <summary>
    /// Проверяет, что действующая ссылка меняет пароль и отзывает refresh-токены
    /// </summary>
    [Fact]
    public async Task Confirm_WithValidLink_ChangesPasswordAndRevokesRefresh()
    {
        var email = UniqueEmail();
        await CreateUserAsync(email);
        using var client = NewClient();
        var login = await Login(client, email, "old-password-1");
        var refresh = login.Headers.GetValues("Set-Cookie").First(v => v.StartsWith("refresh_token=")).Split(';')[0];
        await RequestReset(client, email);
        var token = TokenFromEmail(LastEmail(email)!);

        var response = await Confirm(client, token, "new-password-1");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(client, email, "new-password-1")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(client, email, "old-password-1")).StatusCode);
        var update = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        update.Headers.Add("Cookie", refresh);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(update)).StatusCode);
    }

    /// <summary>
    /// Проверяет, что повторное использование ссылки отклоняется
    /// </summary>
    [Fact]
    public async Task Confirm_ReusingSameLink_IsRejected()
    {
        var email = UniqueEmail();
        await CreateUserAsync(email);
        using var client = NewClient();
        await RequestReset(client, email);
        var token = TokenFromEmail(LastEmail(email)!);
        Assert.Equal(HttpStatusCode.NoContent, (await Confirm(client, token, "new-password-1")).StatusCode);

        var repeat = await Confirm(client, token, "another-password-2");

        Assert.Equal(HttpStatusCode.BadRequest, repeat.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(client, email, "new-password-1")).StatusCode);
    }

    /// <summary>
    /// Проверяет, что просроченная ссылка отклоняется
    /// </summary>
    [Fact]
    public async Task Confirm_WithExpiredLink_IsRejected()
    {
        var email = UniqueEmail();
        await CreateUserAsync(email);
        using var client = NewClient();
        await RequestReset(client, email);
        var token = TokenFromEmail(LastEmail(email)!);
        await using (var connection = new NpgsqlConnection(factory.ConnectionString))
        {
            await connection.ExecuteAsync(
                "update password_reset_tokens set expires_at = now() - interval '1 minute' where token_hash = @hash",
                new { hash = Auth.OpaqueTokens.Hash(token) });
        }

        var response = await Confirm(client, token, "new-password-1");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(client, email, "old-password-1")).StatusCode);
    }

    /// <summary>
    /// Проверяет, что произвольный токен или короткий пароль отклоняются
    /// </summary>
    [Fact]
    public async Task Confirm_WithArbitraryTokenOrShortPassword_IsRejected()
    {
        var email = UniqueEmail();
        await CreateUserAsync(email);
        using var client = NewClient();
        await RequestReset(client, email);
        var token = TokenFromEmail(LastEmail(email)!);

        Assert.Equal(HttpStatusCode.BadRequest, (await Confirm(client, "не-тот-токен", "new-password-1")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Confirm(client, token, "short")).StatusCode);
        // слабый пароль не сжигает ссылку
        Assert.Equal(HttpStatusCode.NoContent, (await Confirm(client, token, "new-password-1")).StatusCode);
    }

    /// <summary>
    /// Проверяет, что отключённому пользователю письмо не отправляется
    /// </summary>
    [Fact]
    public async Task Request_ForDisabledUser_SendsNoMail()
    {
        var email = UniqueEmail();
        var user = await CreateUserAsync(email);
        using var admin = await Administrator();
        await admin.PostAsync($"/api/admin/users/{user.Id}/disable", null);
        using var client = NewClient();

        var response = await RequestReset(client, email);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Null(LastEmail(email));
    }

    /// <summary>
    /// Проверяет, что администратор отправляет ссылку пользователю, а обычный пользователь получает 403
    /// </summary>
    [Fact]
    public async Task Administrator_SendsResetLinkToUser_MemberGets403()
    {
        var email = UniqueEmail();
        var user = await CreateUserAsync(email);
        using var admin = await Administrator();

        var response = await admin.PostAsync($"/api/admin/users/{user.Id}/password-reset", null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var mail = LastEmail(email);
        Assert.NotNull(mail);
        Assert.Equal(HttpStatusCode.NoContent, (await Confirm(NewClient(), TokenFromEmail(mail!), "new-password-1")).StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"/api/admin/users/{Guid.NewGuid()}/password-reset", null)).StatusCode);

        using var member = NewClient();
        var login = await Login(member, email, "new-password-1");
        member.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsync($"/api/admin/users/{user.Id}/password-reset", null)).StatusCode);
    }
}
