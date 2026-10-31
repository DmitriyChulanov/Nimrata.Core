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
