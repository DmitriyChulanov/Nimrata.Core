using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Nimrata.Core.Server.Objects;
using Npgsql;

namespace Nimrata.Core.Server.Controllers;

[ApiController]
public sealed class ObjectsController(NpgsqlDataSource источник, ChangesetService наборы) : ControllerBase
{
    private sealed record Строка(Guid Id, string Type, Guid? Parent, double Order, JsonElement Properties);

    private Guid Пользователь => Guid.Parse(User.FindFirstValue("sub") ?? User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    /// <summary>Все объекты текущего пользователя и только они.</summary>
    [HttpGet("api/objects")]
    public async Task<IActionResult> Загрузить()
    {
        await using var соединение = await источник.OpenConnectionAsync();
        var строки = await соединение.QueryAsync<Строка>(
            """
            select id as Id, type_id as Type, parent_id as Parent, sort_order as "Order", properties as Properties
            from objects where owner_id = @пользователь order by sort_order, id
            """, new { пользователь = Пользователь });
        var результат = new JsonArray();
        foreach (var с in строки)
        {
            результат.Add(new JsonObject
            {
                ["id"] = с.Id,
                ["type"] = с.Type,
                ["parent"] = с.Parent,
                ["order"] = с.Order,
                ["properties"] = JsonNode.Parse(с.Properties.GetRawText()),
            });
        }
        return Content(результат.ToJsonString(), "application/json");
    }

    /// <summary>Применяет набор изменений целиком или отклоняет его с причиной.</summary>
    [HttpPost("api/changesets")]
    public async Task<IActionResult> Применить([FromBody] JsonElement тело)
    {
        try
        {
            var id = await наборы.Применить(Пользователь, тело);
            return Ok(new { id });
        }
        catch (ChangesetRejectedException отказ)
        {
            return StatusCode(отказ.Conflict ? StatusCodes.Status409Conflict : StatusCodes.Status422UnprocessableEntity,
                new { error = отказ.Message });
        }
    }
}
