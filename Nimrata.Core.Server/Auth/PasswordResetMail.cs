namespace Nimrata.Core.Server.Auth;

/// <summary>Формирование письма со ссылкой на смену пароля</summary>
public static class PasswordResetMail
{
    /// <summary>Ссылка на экран смены пароля с токеном в параметре запроса</summary>
    public static string BuildLink(string publicUrl, string token) =>
        $"{publicUrl.TrimEnd('/')}/reset-password?token={Uri.EscapeDataString(token)}";

    public static EmailMessage Compose(string to, string link, TimeSpan lifetime) => new(
        to,
        "Смена пароля в Nimrata",
        $"""
        Для смены пароля перейдите по ссылке:
        {link}

        Ссылка одноразовая и действует {(int)lifetime.TotalMinutes} мин. Если вы не запрашивали смену пароля, просто проигнорируйте это письмо.
        """);
}
