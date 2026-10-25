using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

/// <summary>Сброс пароля по e-mail: HTTP API с поддельной почтой (фабрика с Postgres в Testcontainers).</summary>
public class PasswordResetTests(ServerFactory фабрика) : IClassFixture<ServerFactory>
{
    private record UserDto(Guid Id, string Email);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private HttpClient Клиент() => фабрика.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

    private static string Уникальный() => $"r{Guid.NewGuid():N}@example.test";

    private async Task<HttpClient> Администратор()
    {
        var клиент = Клиент();
        var вход = await клиент.PostAsJsonAsync("/api/auth/login", new { email = ServerFactory.AdminEmail, password = ServerFactory.AdminPassword });
        var токен = (await вход.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        клиент.DefaultRequestHeaders.Authorization = new("Bearer", токен);
        return клиент;
    }

    private async Task<UserDto> СоздатьПользователя(string email, string пароль = "old-password-1")
    {
        using var админ = await Администратор();
        var ответ = await админ.PostAsJsonAsync("/api/admin/users", new { email, name = "Имя", password = пароль, role = "member" });
        Assert.Equal(HttpStatusCode.Created, ответ.StatusCode);
        return (await ответ.Content.ReadFromJsonAsync<UserDto>(Json))!;
    }

    private static string ТокенИзПисьма(Auth.Письмо письмо) =>
        Uri.UnescapeDataString(Regex.Match(письмо.Текст, @"token=([^\s]+)").Groups[1].Value);

    private Auth.Письмо? ПоследнееПисьмо(string email) =>
        фабрика.Почта.Письма.LastOrDefault(п => п.Кому == email);

    private static Task<HttpResponseMessage> Запросить(HttpClient клиент, string email) =>
        клиент.PostAsJsonAsync("/api/auth/forgot-password", new { email });

    private static Task<HttpResponseMessage> Подтвердить(HttpClient клиент, string токен, string пароль) =>
        клиент.PostAsJsonAsync("/api/auth/reset-password", new { token = токен, password = пароль });

    private static Task<HttpResponseMessage> Войти(HttpClient клиент, string email, string пароль) =>
        клиент.PostAsJsonAsync("/api/auth/login", new { email, password = пароль });

    [Fact]
    public async Task Запрос_ДляИзвестногоИНеизвестногоEmail_ОтвечаетОдинаковоИШлётПисьмоТолькоСуществующему()
    {
        var email = Уникальный();
        await СоздатьПользователя(email);
        using var клиент = Клиент();

        var известный = await Запросить(клиент, email);
        var неизвестный = await Запросить(клиент, "nobody-" + Уникальный());

        Assert.Equal(известный.StatusCode, неизвестный.StatusCode);
        Assert.Equal(await известный.Content.ReadAsStringAsync(), await неизвестный.Content.ReadAsStringAsync());
        Assert.NotNull(ПоследнееПисьмо(email));
        Assert.DoesNotContain(фабрика.Почта.Письма, п => п.Кому.StartsWith("nobody-"));
        Assert.Contains("https://nimrata.test/reset-password?token=", ПоследнееПисьмо(email)!.Текст);
    }

    [Fact]
    public async Task Подтверждение_СПравильнойСсылкой_МеняетПарольИОтзываетRefresh()
    {
        var email = Уникальный();
        await СоздатьПользователя(email);
        using var клиент = Клиент();
        var вход = await Войти(клиент, email, "old-password-1");
        var refresh = вход.Headers.GetValues("Set-Cookie").First(v => v.StartsWith("refresh_token=")).Split(';')[0];
        await Запросить(клиент, email);
        var токен = ТокенИзПисьма(ПоследнееПисьмо(email)!);

        var ответ = await Подтвердить(клиент, токен, "new-password-1");

        Assert.Equal(HttpStatusCode.NoContent, ответ.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Войти(клиент, email, "new-password-1")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Войти(клиент, email, "old-password-1")).StatusCode);
        var обновление = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        обновление.Headers.Add("Cookie", refresh);
        Assert.Equal(HttpStatusCode.Unauthorized, (await клиент.SendAsync(обновление)).StatusCode);
    }

    [Fact]
    public async Task Подтверждение_ПовторноСТойЖеСсылкой_Отклоняется()
    {
        var email = Уникальный();
        await СоздатьПользователя(email);
        using var клиент = Клиент();
        await Запросить(клиент, email);
        var токен = ТокенИзПисьма(ПоследнееПисьмо(email)!);
        Assert.Equal(HttpStatusCode.NoContent, (await Подтвердить(клиент, токен, "new-password-1")).StatusCode);

        var повтор = await Подтвердить(клиент, токен, "another-password-2");

        Assert.Equal(HttpStatusCode.BadRequest, повтор.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Войти(клиент, email, "new-password-1")).StatusCode);
    }

    [Fact]
    public async Task Подтверждение_СИстёкшейСсылкой_Отклоняется()
    {
        var email = Уникальный();
        await СоздатьПользователя(email);
        using var клиент = Клиент();
        await Запросить(клиент, email);
        var токен = ТокенИзПисьма(ПоследнееПисьмо(email)!);
        await using (var соединение = new NpgsqlConnection(фабрика.ConnectionString))
        {
            await соединение.ExecuteAsync(
                "update password_reset_tokens set expires_at = now() - interval '1 minute' where token_hash = @хеш",
                new { хеш = Auth.ResetTokens.Хеш(токен) });
        }

        var ответ = await Подтвердить(клиент, токен, "new-password-1");

        Assert.Equal(HttpStatusCode.BadRequest, ответ.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Войти(клиент, email, "old-password-1")).StatusCode);
    }

    [Fact]
    public async Task Подтверждение_СПроизвольнымТокеном_ИлиКоротким_Паролем_Отклоняется()
    {
        var email = Уникальный();
        await СоздатьПользователя(email);
        using var клиент = Клиент();
        await Запросить(клиент, email);
        var токен = ТокенИзПисьма(ПоследнееПисьмо(email)!);

        Assert.Equal(HttpStatusCode.BadRequest, (await Подтвердить(клиент, "не-тот-токен", "new-password-1")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Подтвердить(клиент, токен, "short")).StatusCode);
        // слабый пароль не сжигает ссылку
        Assert.Equal(HttpStatusCode.NoContent, (await Подтвердить(клиент, токен, "new-password-1")).StatusCode);
    }

    [Fact]
    public async Task Запрос_ДляОтключённогоПользователя_ПисьмоНеУходит()
    {
        var email = Уникальный();
        var пользователь = await СоздатьПользователя(email);
        using var админ = await Администратор();
        await админ.PostAsync($"/api/admin/users/{пользователь.Id}/disable", null);
        using var клиент = Клиент();

        var ответ = await Запросить(клиент, email);

        Assert.Equal(HttpStatusCode.Accepted, ответ.StatusCode);
        Assert.Null(ПоследнееПисьмо(email));
    }

    [Fact]
    public async Task Администратор_ОтправляетСсылкуПользователю_УчастникПолучает403()
    {
        var email = Уникальный();
        var пользователь = await СоздатьПользователя(email);
        using var админ = await Администратор();

        var ответ = await админ.PostAsync($"/api/admin/users/{пользователь.Id}/password-reset", null);

        Assert.Equal(HttpStatusCode.NoContent, ответ.StatusCode);
        var письмо = ПоследнееПисьмо(email);
        Assert.NotNull(письмо);
        Assert.Equal(HttpStatusCode.NoContent, (await Подтвердить(Клиент(), ТокенИзПисьма(письмо!), "new-password-1")).StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await админ.PostAsync($"/api/admin/users/{Guid.NewGuid()}/password-reset", null)).StatusCode);

        using var участник = Клиент();
        var вход = await Войти(участник, email, "new-password-1");
        участник.DefaultRequestHeaders.Authorization = new("Bearer", (await вход.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken);
        Assert.Equal(HttpStatusCode.Forbidden, (await участник.PostAsync($"/api/admin/users/{пользователь.Id}/password-reset", null)).StatusCode);
    }
}
