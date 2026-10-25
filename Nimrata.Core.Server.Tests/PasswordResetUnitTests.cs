using Nimrata.Core.Server.Auth;

namespace Nimrata.Core.Server.Tests;

/// <summary>Логика сброса пароля, не требующая БД: токены и письмо.</summary>
public class PasswordResetUnitTests
{
    [Fact]
    public void Токен_УникаленИНеСовпадаетСХешем()
    {
        var а = ResetTokens.Создать();
        var б = ResetTokens.Создать();

        Assert.NotEqual(а.Токен, б.Токен);
        Assert.NotEqual(а.Токен, а.Хеш);
        Assert.True(а.Токен.Length >= 43); // 32 байта в base64url
    }

    [Fact]
    public void Хеш_ДетерминированИСовпадаетСХешемВыданногоТокена()
    {
        var токен = ResetTokens.Создать();

        Assert.Equal(токен.Хеш, ResetTokens.Хеш(токен.Токен));
        Assert.NotEqual(токен.Хеш, ResetTokens.Хеш(токен.Токен + "x"));
    }

    [Fact]
    public void Токен_БезопасенДляUrl()
    {
        var токен = ResetTokens.Создать().Токен;

        Assert.Equal(токен, Uri.EscapeDataString(токен));
    }

    [Fact]
    public void Ссылка_СтроитсяОтПубличногоАдресаИЭкранируетТокен()
    {
        Assert.Equal("https://nimrata.test/reset-password?token=abc%2B1",
            PasswordResetMail.Ссылка("https://nimrata.test/", "abc+1"));
        Assert.Equal("http://localhost:8080/reset-password?token=t",
            PasswordResetMail.Ссылка("http://localhost:8080", "t"));
    }

    [Fact]
    public void Письмо_СодержитСсылкуИСрокДействия()
    {
        var письмо = PasswordResetMail.Составить("user@example.test", "https://nimrata.test/reset-password?token=t", TimeSpan.FromMinutes(90));

        Assert.Equal("user@example.test", письмо.Кому);
        Assert.Contains("пароля", письмо.Тема);
        Assert.Contains("https://nimrata.test/reset-password?token=t", письмо.Текст);
        Assert.Contains("90 мин", письмо.Текст);
    }
}
