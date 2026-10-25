using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Objects;

/// <summary>Чтение типов платформы, синхронизированных из манифестов модулей</summary>
public sealed class TypesService(NpgsqlDataSource dataSource)
{
    private sealed record TypeRow(string Id, string ModuleId, int ModuleVersion, JsonElement Definition);

    /// <summary>Определения всех типов, дополненные полями <c>id</c>, <c>module</c> и <c>moduleVersion</c></summary>
    public async Task<IReadOnlyList<JsonObject>> ListAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<TypeRow>(new CommandDefinition(
            """
            select id as Id, module_id as ModuleId, module_version as ModuleVersion, definition as Definition
            from types order by id
            """,
            cancellationToken: cancellationToken));
        return rows.Select(ToDefinition).ToList();
    }

    private static JsonObject ToDefinition(TypeRow row)
    {
        var definition = JsonNode.Parse(row.Definition.GetRawText())?.AsObject()
            ?? throw new InvalidOperationException($"Определение типа {row.Id} не является объектом.");
        definition["id"] = row.Id;
        definition["module"] = row.ModuleId;
        definition["moduleVersion"] = row.ModuleVersion;
        return definition;
    }
}
