using Nimrata.Core.Server.Auth;

namespace Nimrata.Core.Server.Tests;

/// <summary>Логика сброса пароля, не требующая БД: токены и письмо</summary>
public class PasswordResetUnitTests
{
    [Fact]
    public void Token_IsUniqueAndDiffersFromHash()
    {
        var first = OpaqueTokens.Create();
        var second = OpaqueTokens.Create();

        Assert.NotEqual(first.Value, second.Value);
        Assert.NotEqual(first.Value, first.Hash);
        Assert.True(first.Value.Length >= 43); // 32 байта в base64url
    }

    [Fact]
    public void Hash_IsDeterministicAndMatchesIssuedTokenHash()
    {
        var token = OpaqueTokens.Create();

        Assert.Equal(token.Hash, OpaqueTokens.Hash(token.Value));
        Assert.NotEqual(token.Hash, OpaqueTokens.Hash(token.Value + "x"));
    }

    [Fact]
    public void Token_IsUrlSafe()
    {
        var token = OpaqueTokens.Create().Value;

        Assert.Equal(token, Uri.EscapeDataString(token));
    }

    [Fact]
    public void Link_BuiltFromPublicUrlAndEscapesToken()
    {
        Assert.Equal("https://nimrata.test/reset-password?token=abc%2B1",
            PasswordResetMail.BuildLink("https://nimrata.test/", "abc+1"));
        Assert.Equal("http://localhost:8080/reset-password?token=t",
            PasswordResetMail.BuildLink("http://localhost:8080", "t"));
    }

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
