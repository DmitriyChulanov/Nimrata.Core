namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Одноразовый токен: клиенту уходит <see cref="Value"/>, в БД хранится только <see cref="Hash"/>
/// </summary>
public sealed record OpaqueToken(string Value, string Hash);
