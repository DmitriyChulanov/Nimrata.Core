namespace Nimrata.Core.Server.Objects;

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

    /// <summary>
    /// Данные набора не принимает БД (класс SQLSTATE 22 или 23: неверное значение, нарушение ограничения,
    /// занятый идентификатор); повтор того же набора дал бы тот же отказ
    /// </summary>
    public const string InvalidData = "invalid_data";
}
