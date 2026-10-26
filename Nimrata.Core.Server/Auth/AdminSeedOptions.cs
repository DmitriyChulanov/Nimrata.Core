namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Первый администратор (раздел <c>Admin</c>): создаётся при старте, если ещё не существует
/// </summary>
public sealed class AdminSeedOptions
{
    /// <summary>
    /// Имя раздела конфигурации
    /// </summary>
    public const string Section = "Admin";

    /// <summary>
    /// Адрес первого администратора
    /// </summary>
    public string? Email { get; set; }
    /// <summary>
    /// Пароль первого администратора
    /// </summary>
    public string? Password { get; set; }
}
