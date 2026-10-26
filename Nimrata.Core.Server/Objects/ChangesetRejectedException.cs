namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Набор изменений отклонён; <see cref="Exception.Message"/> пригоден для показа пользователю
/// </summary>
public sealed class ChangesetRejectedException(string message, bool conflict = false) : Exception(message)
{
    /// <summary>
    /// Отказ из-за расхождения с текущими данными (клиенту стоит перезагрузить объекты)
    /// </summary>
    public bool Conflict { get; } = conflict;
}
