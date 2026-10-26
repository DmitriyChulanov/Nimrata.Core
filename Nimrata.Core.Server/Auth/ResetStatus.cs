namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Итог операции со ссылкой сброса пароля
/// </summary>
public enum ResetStatus
{
    /// <summary>
    /// Пароль изменён
    /// </summary>
    Ok,
    /// <summary>
    /// Ссылка не найдена, использована или просрочена
    /// </summary>
    NotFound,
    /// <summary>
    /// Новый пароль не соответствует требованиям
    /// </summary>
    Invalid,
}
