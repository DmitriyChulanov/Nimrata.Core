using Nimrata.Core.Server.Auth;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Логика сброса пароля, не требующая БД: токены и письмо
/// </summary>
public class PasswordResetUnitTests
{
    /// <summary>
    /// Проверяет, что токены уникальны и отличаются от своих хешей
    /// </summary>
    [Fact]
    public void Token_IsUniqueAndDiffersFromHash()
    {
        var first = OpaqueTokens.Create();
        var second = OpaqueTokens.Create();

        Assert.NotEqual(first.Value, second.Value);
        Assert.NotEqual(first.Value, first.Hash);
        Assert.True(first.Value.Length >= 43); // 32 байта в base64url
    }

    /// <summary>
    /// Проверяет, что хеш детерминирован и совпадает с хешем выпущенного токена
    /// </summary>
    [Fact]
    public void Hash_IsDeterministicAndMatchesIssuedTokenHash()
    {
        var token = OpaqueTokens.Create();

        Assert.Equal(token.Hash, OpaqueTokens.Hash(token.Value));
        Assert.NotEqual(token.Hash, OpaqueTokens.Hash(token.Value + "x"));
    }

    /// <summary>
    /// Проверяет, что токен безопасен для вставки в адрес
    /// </summary>
    [Fact]
    public void Token_IsUrlSafe()
    {
        var token = OpaqueTokens.Create().Value;

        Assert.Equal(token, Uri.EscapeDataString(token));
    }

    /// <summary>
    /// Проверяет, что ссылка строится от публичного адреса и экранирует токен
    /// </summary>
    [Fact]
    public void Link_BuiltFromPublicUrlAndEscapesToken()
    {
        Assert.Equal("https://nimrata.test/reset-password?token=abc%2B1",
            PasswordResetMail.BuildLink("https://nimrata.test/", "abc+1"));
        Assert.Equal("http://localhost:8080/reset-password?token=t",
            PasswordResetMail.BuildLink("http://localhost:8080", "t"));
    }

    /// <summary>
    /// Проверяет, что письмо содержит ссылку и срок действия
    /// </summary>
    [Fact]
    public void Email_ContainsLinkAndLifetime()
    {
        var email = PasswordResetMail.Compose("user@example.test", "https://nimrata.test/reset-password?token=t", TimeSpan.FromMinutes(90));

        Assert.Equal("user@example.test", email.To);
        Assert.Contains("пароля", email.Subject);
        Assert.Contains("https://nimrata.test/reset-password?token=t", email.Body);
        Assert.Contains("90 мин", email.Body);
    }
}
