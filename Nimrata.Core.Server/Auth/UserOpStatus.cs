namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Итог операции администрирования пользователя
/// </summary>
public enum UserOpStatus
{
    /// <summary>
    /// Операция выполнена
    /// </summary>
    Ok,
    /// <summary>
    /// Пользователь не найден
    /// </summary>
    NotFound,
    /// <summary>
    /// Некорректные входные данные
    /// </summary>
    Invalid,
    /// <summary>
    /// Операция нарушает ограничения, например дубликат или последний администратор
    /// </summary>
    Conflict,
}
