namespace Nimrata.Core.Server.Auth;

/// <summary>Настройки сброса пароля (раздел <c>PasswordReset</c>)</summary>
public sealed class PasswordResetOptions
{
    public const string Section = "PasswordReset";

    public int LifetimeMinutes { get; set; } = 60;

    /// <summary>Публичный адрес приложения для ссылки в письме (не берётся из заголовков запроса)</summary>
    public string PublicUrl { get; set; } = "https://localhost:61625";
}
