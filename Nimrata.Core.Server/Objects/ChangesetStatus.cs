using System.Text.Json.Serialization;

namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Итог набора пакетной записи; в JSON — строки <c>applied</c>, <c>duplicate</c>, <c>rejected</c>
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<ChangesetStatus>))]
public enum ChangesetStatus
{
    /// <summary>
    /// Набор применён
    /// </summary>
    [JsonStringEnumMemberName("applied")]
    Applied,

    /// <summary>
    /// Повтор уже применённого набора
    /// </summary>
    [JsonStringEnumMemberName("duplicate")]
    Duplicate,

    /// <summary>
    /// Набор отклонён
    /// </summary>
    [JsonStringEnumMemberName("rejected")]
    Rejected,
}
