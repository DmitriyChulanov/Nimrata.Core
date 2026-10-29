using System.Text.Json.Serialization;

namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Итог одного набора пакетной записи
/// </summary>
/// <param name="Id">Идентификатор набора, присланный клиентом</param>
/// <param name="Status">Итог набора</param>
/// <param name="Seq">Курсор набора: у применённого и повтора; у отклонённого отсутствует</param>
/// <param name="PrevSeq">
/// Курсор предыдущего набора того же пользователя (0 — набор первый): у применённого и повтора. <c>seq</c>
/// глобальный и у пользователя идёт с дырами, поэтому клиент сдвигает курсор, только если <c>prevSeq</c>
/// равен его курсору; иначе между ними есть наборы других вкладок
/// </param>
/// <param name="Code">Машинный код отказа (<see cref="RejectionCodes"/>), если клиент его различает</param>
/// <param name="Detail">Причина отказа, пригодная для показа пользователю</param>
public sealed record ChangesetResult(
    Guid Id,
    ChangesetStatus Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Seq = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? PrevSeq = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Code = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Detail = null)
{
    /// <summary>
    /// Набор применён и получил курсор
    /// </summary>
    /// <param name="id">Идентификатор набора</param>
    /// <param name="seq">Курсор набора</param>
    /// <param name="prevSeq">Курсор предыдущего набора пользователя; 0 — набор первый</param>
    /// <returns>Итог «применён»</returns>
    public static ChangesetResult Applied(Guid id, long seq, long prevSeq) =>
        new(id, ChangesetStatus.Applied, seq, prevSeq);

    /// <summary>
    /// Набор с этим идентификатором уже применён раньше; ничего не применялось
    /// </summary>
    /// <param name="id">Идентификатор набора</param>
    /// <param name="seq">Курсор, полученный набором при первом применении</param>
    /// <param name="prevSeq">Курсор набора пользователя, предшествующего этому в журнале; 0 — такого нет</param>
    /// <returns>Итог «повтор»</returns>
    public static ChangesetResult Duplicate(Guid id, long seq, long prevSeq) =>
        new(id, ChangesetStatus.Duplicate, seq, prevSeq);

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
