namespace Nimrata.Core.Server.Controllers.Requests;

/// <summary>Учётные данные для входа</summary>
public sealed record LoginRequest(string? Email, string? Password);
