using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace Nimrata.Core.Server.Controllers;

[ApiController]
[Route("api/types")]
public sealed class TypesController(NpgsqlDataSource источник) : ControllerBase
{
    private sealed record Строка(string Id, string ModuleId, int ModuleVersion, JsonElement Definition);

    /// <summary>Все типы платформы: определение из манифеста плюс <c>module</c> и <c>moduleVersion</c>.</summary>
    [HttpGet]
    public async Task<IActionResult> Список()
    {
        await using var соединение = await источник.OpenConnectionAsync();
        var строки = await соединение.QueryAsync<Строка>(
            "select id as Id, module_id as ModuleId, module_version as ModuleVersion, definition as Definition from types order by id");
        var результат = new JsonArray();
        foreach (var строка in строки)
        {
            var тип = JsonNode.Parse(строка.Definition.GetRawText())!.AsObject();
            тип["id"] = строка.Id;
            тип["module"] = строка.ModuleId;
            тип["moduleVersion"] = строка.ModuleVersion;
            результат.Add(тип);
        }
        return Content(результат.ToJsonString(), "application/json");
    }
}
