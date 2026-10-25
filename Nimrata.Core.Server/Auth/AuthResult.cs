namespace Nimrata.Core.Server.Auth;

/// <summary>Пара токенов, выданная при входе или обновлении</summary>
public sealed record AuthResult(string AccessToken, string RefreshToken, DateTimeOffset RefreshExpiresAt);
