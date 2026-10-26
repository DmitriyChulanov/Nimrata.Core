namespace Nimrata.Core.Server.Controllers.Requests;

/// <summary>
/// Установка нового пароля по токену из письма
/// </summary>
public sealed record ResetPasswordRequest(string? Token, string? Password);
