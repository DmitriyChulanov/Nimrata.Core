namespace Nimrata.Core.Server.Auth;

/// <summary>Итог операции со ссылкой сброса пароля</summary>
public enum ResetStatus
{
    Ok,
    NotFound,
    Invalid,
}
