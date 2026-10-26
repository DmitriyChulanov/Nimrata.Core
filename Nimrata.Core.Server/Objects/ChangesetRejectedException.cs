namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Набор изменений отклонён; <see cref="Exception.Message"/> пригоден для показа пользователю
/// </summary>
public sealed class ChangesetRejectedException(string message, bool conflict = false, string? code = null) : Exception(message)
{
    /// <summary>
    /// Отказ из-за расхождения с текущими данными (клиенту стоит перезагрузить объекты)
    /// </summary>
    public bool Conflict { get; } = conflict;

    /// <summary>
    /// Стабильный код причины для программной обработки на клиенте (см. <see cref="RejectionCodes"/>);
    /// <c>null</c> у отказов, которые клиент отдельно не различает
    /// </summary>
    public string? Code { get; } = code;
}

/// <summary>
/// Коды причин отказа набора изменений, которые клиент отличает от прочих
/// </summary>
public static class RejectionCodes
{
    /// <summary>
    /// Запись в объекты (или под родителя) типа отключённого расширения
    /// </summary>
    public const string ExtensionDisabled = "extension_disabled";

    /// <summary>
    /// Второй объект типа <c>singleton</c> у того же родителя и владельца
    /// </summary>
    public const string SingletonExists = "singleton_exists";
}
