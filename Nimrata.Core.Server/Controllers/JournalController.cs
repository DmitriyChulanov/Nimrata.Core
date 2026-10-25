using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace Nimrata.Core.Server.Controllers;

/// <summary>Чтение журнала изменений. Только GET: журнал через API не правится.</summary>
[ApiController]
public sealed class JournalController(NpgsqlDataSource источник) : ControllerBase
{
    private const int МаксимумНаСтранице = 200;

    private sealed record Запись(
        long Id, Guid ChangesetId, DateTime At, string User, Guid ObjectId, string Operation, string? Property,
        JsonElement? OldValue, JsonElement? NewValue, JsonElement? Snapshot);

    private Guid Пользователь => Guid.Parse(User.FindFirstValue("sub") ?? User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    /// <summary>
    /// Записи журнала текущего пользователя от новых к старым: все или по одному объекту (<paramref name="objectId"/>).
    /// Чужие записи не возвращаются никогда.
    /// </summary>
    [HttpGet("api/journal")]
    public async Task<IActionResult> Прочитать(Guid? objectId, int skip = 0, int take = 50)
    {
        if (skip < 0 || take < 1 || take > МаксимумНаСтранице)
        {
            return BadRequest(new { error = $"skip должен быть не меньше 0, take — от 1 до {МаксимумНаСтранице}." });
        }

        await using var соединение = await источник.OpenConnectionAsync();
        var параметры = new { пользователь = Пользователь, объект = objectId, skip, take };
        const string условие = "c.user_id = @пользователь and (@объект::uuid is null or e.object_id = @объект::uuid)";

        var всего = await соединение.ExecuteScalarAsync<long>(
            $"""
            select count(*) from changeset_entries e join changesets c on c.id = e.changeset_id
            where {условие}
            """, параметры);
        var строки = await соединение.QueryAsync<Запись>(
            $"""
            select e.id as Id, e.changeset_id as ChangesetId, c.created_at as At, u.email as "User",
                   e.object_id as ObjectId, e.operation as Operation, e.property as Property,
                   e.old_value as OldValue, e.new_value as NewValue, e.snapshot as Snapshot
            from changeset_entries e
            join changesets c on c.id = e.changeset_id
            join users u on u.id = c.user_id
            where {условие}
            order by c.created_at desc, e.id desc
            offset @skip limit @take
            """, параметры);

        var элементы = new JsonArray();
        foreach (var с in строки)
        {
            элементы.Add(new JsonObject
            {
                ["id"] = с.Id,
                ["changesetId"] = с.ChangesetId,
                ["at"] = DateTime.SpecifyKind(с.At, DateTimeKind.Utc),
                ["user"] = с.User,
                ["objectId"] = с.ObjectId,
                ["operation"] = с.Operation,
                ["property"] = с.Property,
                ["old"] = Узел(с.OldValue),
                ["new"] = Узел(с.NewValue),
                ["snapshot"] = Узел(с.Snapshot),
            });
        }
        return Content(new JsonObject { ["items"] = элементы, ["total"] = всего }.ToJsonString(), "application/json");
    }

    private static JsonNode? Узел(JsonElement? значение) =>
        значение is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined } з
            ? JsonNode.Parse(з.GetRawText()) : null;
}
