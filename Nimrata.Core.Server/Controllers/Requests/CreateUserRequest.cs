namespace Nimrata.Core.Server.Controllers.Requests;

/// <summary>Данные нового пользователя</summary>
public sealed record CreateUserRequest(string? Email, string? Name, string? Password, string? Role);
