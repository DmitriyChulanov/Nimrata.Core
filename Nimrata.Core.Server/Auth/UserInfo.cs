namespace Nimrata.Core.Server.Auth;

/// <summary>Пользователь в списке администрирования</summary>
public sealed record UserInfo(Guid Id, string Email, string Name, string Role, bool IsActive);
