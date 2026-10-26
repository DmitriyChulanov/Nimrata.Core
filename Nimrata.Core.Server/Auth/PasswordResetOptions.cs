namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Настройки сброса пароля (раздел <c>PasswordReset</c>)
/// </summary>
public sealed class PasswordResetOptions
{
    /// <summary>
    /// Имя раздела конфигурации
    /// </summary>
    public const string Section = "PasswordReset";

    /// <summary>
    /// Время жизни ссылки сброса пароля в минутах
    /// </summary>
    public int LifetimeMinutes { get; set; } = 60;

    /// <summary>
    /// Публичный адрес приложения для ссылки в письме (не берётся из заголовков запроса)
    /// </summary>
    public string PublicUrl { get; set; } = "https://localhost:61625";
}
