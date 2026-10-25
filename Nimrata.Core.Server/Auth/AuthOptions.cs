namespace Nimrata.Core.Server.Auth;

/// <summary>Настройки JWT (раздел <c>Jwt</c>). Ключ подписи задаётся user-secrets или переменной окружения.</summary>
public sealed class JwtOptions
{
    public const string Section = "Jwt";

    public string Key { get; set; } = "";
    public string Issuer { get; set; } = "nimrata";
    public string Audience { get; set; } = "nimrata";
    public int AccessMinutes { get; set; } = 15;
    public int RefreshDays { get; set; } = 30;
}

/// <summary>Первый администратор (раздел <c>Admin</c>): создаётся при старте, если ещё не существует.</summary>
public sealed class AdminSeedOptions
{
    public const string Section = "Admin";

    public string? Email { get; set; }
    public string? Password { get; set; }
}
