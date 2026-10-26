namespace Nimrata.Core.Server.Controllers.Requests;

/// <summary>
/// Запрос ссылки для сброса пароля
/// </summary>
public sealed record ForgotPasswordRequest(string? Email);
