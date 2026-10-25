namespace Nimrata.Core.Server.Auth;

/// <summary>Первый администратор (раздел <c>Admin</c>): создаётся при старте, если ещё не существует</summary>
public sealed class AdminSeedOptions
{
    public const string Section = "Admin";

    public string? Email { get; set; }
    public string? Password { get; set; }
}
