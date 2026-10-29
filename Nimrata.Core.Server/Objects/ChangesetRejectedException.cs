namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Набор изменений отклонён из-за нарушения структурного инварианта или формата операции;
/// <see cref="Exception.Message"/> пригоден для показа пользователю
/// </summary>
/// <param name="message">Причина отказа для пользователя</param>
/// <param name="code">Машинный код причины (<see cref="RejectionCodes"/>); <c>null</c> — клиент её отдельно не различает</param>
public sealed class ChangesetRejectedException(string message, string? code = null) : Exception(message)
{
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
