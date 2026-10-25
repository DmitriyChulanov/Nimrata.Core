namespace Nimrata.Core.Server.Auth;

/// <summary>Итог операции администрирования пользователя</summary>
public enum UserOpStatus
{
    Ok,
    NotFound,
    Invalid,
    Conflict,
}
