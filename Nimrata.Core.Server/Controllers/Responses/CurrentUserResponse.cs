namespace Nimrata.Core.Server.Controllers.Responses;

/// <summary>
/// Текущий аутентифицированный пользователь
/// </summary>
public sealed record CurrentUserResponse(string? Id, string? Email, bool IsAdmin);
