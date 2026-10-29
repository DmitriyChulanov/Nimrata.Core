using System.Text.Json.Serialization;

namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Итог одного набора пакетной записи
/// </summary>
/// <param name="Id">Идентификатор набора, присланный клиентом</param>
/// <param name="Status">Итог из <see cref="ChangesetStatus"/></param>
/// <param name="Seq">Курсор набора: у применённого и повтора; у отклонённого отсутствует</param>
/// <param name="Code">Машинный код отказа (<see cref="RejectionCodes"/>), если клиент его различает</param>
/// <param name="Detail">Причина отказа, пригодная для показа пользователю</param>
public sealed record ChangesetResult(
    Guid Id,
    string Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Seq = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Code = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Detail = null)
{
    /// <summary>
    /// Набор применён и получил курсор
    /// </summary>
    /// <param name="id">Идентификатор набора</param>
    /// <param name="seq">Курсор набора</param>
    /// <returns>Итог «применён»</returns>
    public static ChangesetResult Applied(Guid id, long seq) => new(id, ChangesetStatus.Applied, seq);

    /// <summary>
    /// Набор с этим идентификатором уже применён раньше; ничего не применялось
    /// </summary>
    /// <param name="id">Идентификатор набора</param>
    /// <param name="seq">Курсор, полученный набором при первом применении</param>
    /// <returns>Итог «повтор»</returns>
    public static ChangesetResult Duplicate(Guid id, long seq) => new(id, ChangesetStatus.Duplicate, seq);

    /// <summary>
    /// Набор отклонён целиком
    /// </summary>
    /// <param name="id">Идентификатор набора</param>
    /// <param name="detail">Причина для пользователя</param>
    /// <param name="code">Машинный код причины; <c>null</c> — клиент её отдельно не различает</param>
    /// <returns>Итог «отклонён»</returns>
    public static ChangesetResult Rejected(Guid id, string detail, string? code = null) =>
        new(id, ChangesetStatus.Rejected, Code: code, Detail: detail);
}

/// <summary>
/// Значения поля <c>status</c> итога набора
/// </summary>
public static class ChangesetStatus
{
    /// <summary>
    /// Набор применён
    /// </summary>
    public const string Applied = "applied";

    /// <summary>
    /// Повтор уже применённого набора
    /// </summary>
    public const string Duplicate = "duplicate";

    /// <summary>
    /// Набор отклонён
    /// </summary>
    public const string Rejected = "rejected";
}
