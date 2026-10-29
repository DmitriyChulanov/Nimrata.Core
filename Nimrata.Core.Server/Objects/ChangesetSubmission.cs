using System.Diagnostics.CodeAnalysis;
using System.Text.Json;

namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Набор из пакета записи: идентификатор от клиента и непустой список операций
/// </summary>
/// <param name="Id">Идентификатор набора (UUIDv7 клиента); по нему сервер распознаёт повторы</param>
/// <param name="Operations">JSON-массив операций; их содержимое проверяет применение набора</param>
public sealed record ChangesetSubmission(Guid Id, JsonElement Operations)
{
    /// <summary>
    /// Разбирает тело <c>POST /api/changesets</c>: <c>{ changesets: [{ id, operations }] }</c>
    /// </summary>
    /// <param name="body">Тело запроса</param>
    /// <param name="submissions">Наборы в порядке тела; при ошибке — пустой список</param>
    /// <param name="error">Описание ошибки формата для ответа 400; при успехе — <c>null</c></param>
    /// <returns><c>true</c>, если формат пакета верен</returns>
    public static bool TryParseBatch(
        JsonElement body,
        out IReadOnlyList<ChangesetSubmission> submissions,
        [NotNullWhen(false)] out string? error)
    {
        submissions = [];
        if (body.ValueKind != JsonValueKind.Object
            || !body.TryGetProperty("changesets", out var changesets)
            || changesets.ValueKind != JsonValueKind.Array)
        {
            error = "Тело запроса должно иметь вид { changesets: [{ id, operations }] }.";
            return false;
        }

        var parsed = new List<ChangesetSubmission>();
        var number = 0;
        foreach (var changeset in changesets.EnumerateArray())
        {
            number++;
            if (changeset.ValueKind != JsonValueKind.Object
                || !changeset.TryGetProperty("id", out var idElement)
                || idElement.ValueKind != JsonValueKind.String
                || !idElement.TryGetGuid(out var id))
            {
                error = $"Набор {number}: нужен идентификатор набора (id, GUID).";
                return false;
            }
            if (!changeset.TryGetProperty("operations", out var operations)
                || operations.ValueKind != JsonValueKind.Array
                || operations.GetArrayLength() == 0)
            {
                error = $"Набор {number}: нужен непустой список операций (operations).";
                return false;
            }
            parsed.Add(new ChangesetSubmission(id, operations.Clone()));
        }

        submissions = parsed;
        error = null;
        return true;
    }
}
