using System.Security.Cryptography;
using System.Text;

namespace Nimrata.Core.Server.Auth;

/// <summary>Одноразовый токен сброса: клиенту уходит <see cref="Токен"/>, в БД хранится только <see cref="Хеш"/>.</summary>
public sealed record ResetToken(string Токен, string Хеш);

public static class ResetTokens
{
    public static ResetToken Создать()
    {
        var токен = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return new ResetToken(токен, Хеш(токен));
    }

    public static string Хеш(string токен) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(токен)));
}

public sealed record Письмо(string Кому, string Тема, string Текст);

/// <summary>Формирование письма со ссылкой на смену пароля.</summary>
public static class PasswordResetMail
{
    public static string Ссылка(string публичныйАдрес, string токен) =>
        $"{публичныйАдрес.TrimEnd('/')}/reset-password?token={Uri.EscapeDataString(токен)}";

    public static Письмо Составить(string кому, string ссылка, TimeSpan срок) => new(
        кому,
        "Смена пароля в Nimrata",
        $"""
        Для смены пароля перейдите по ссылке:
        {ссылка}

        Ссылка одноразовая и действует {(int)срок.TotalMinutes} мин. Если вы не запрашивали смену пароля, просто проигнорируйте это письмо.
        """);
}

/// <summary>Отправка писем; в тестах подменяется поддельной реализацией.</summary>
public interface IEmailSender
{
    Task Отправить(Письмо письмо);
}

/// <summary>Настройки SMTP (раздел <c>Smtp</c>). В разработке письма перехватывает Mailpit.</summary>
public sealed class SmtpOptions
{
    public const string Section = "Smtp";

    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 1025;
    public string From { get; set; } = "nimrata@localhost";
    public string? User { get; set; }
    public string? Password { get; set; }
    public bool UseSsl { get; set; }
}

/// <summary>Настройки сброса пароля (раздел <c>PasswordReset</c>).</summary>
public sealed class PasswordResetOptions
{
    public const string Section = "PasswordReset";

    public int LifetimeMinutes { get; set; } = 60;

    /// <summary>Публичный адрес приложения для ссылки в письме (не берётся из заголовков запроса).</summary>
    public string PublicUrl { get; set; } = "https://localhost:61625";
}
