namespace Nimrata.Core.Server.Controllers.Responses;

/// <summary>Выданный access-токен; <see cref="ExpiresIn"/> в секундах</summary>
public sealed record TokenResponse(string AccessToken, int ExpiresIn);
