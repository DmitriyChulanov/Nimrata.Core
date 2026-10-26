using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Чтение типов платформы, синхронизированных из манифестов расширений
/// </summary>
public sealed class TypesService(NpgsqlDataSource dataSource)
{
    private sealed record TypeRow(string Id, string ExtensionId, int ExtensionVersion, JsonElement Definition);

    /// <summary>
    /// Определения всех типов, дополненные полями <c>id</c>, <c>extension</c> и <c>extensionVersion</c>
    /// </summary>
    public async Task<IReadOnlyList<JsonObject>> ListAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<TypeRow>(new CommandDefinition(
            """
            select id as Id, extension_id as ExtensionId, extension_version as ExtensionVersion, definition as Definition
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
        definition["extension"] = row.ExtensionId;
        definition["extensionVersion"] = row.ExtensionVersion;
        return definition;
    }
}
