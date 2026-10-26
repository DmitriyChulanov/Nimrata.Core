namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Результат операции администрирования; <see cref="Reason"/> пригодна для показа пользователю
/// </summary>
public sealed record UserOpResult(UserOpStatus Status, string? Reason = null, UserInfo? User = null);
