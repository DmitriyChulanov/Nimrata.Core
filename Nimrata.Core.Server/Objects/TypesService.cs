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
    /// <param name="cancellationToken">Отмена чтения</param>
    /// <returns>Определения типов по идентификатору</returns>
    public async Task<IReadOnlyList<JsonObject>> ListAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await QueryAsync(connection, null, cancellationToken);
    }

    /// <summary>
    /// Определения всех типов (как у <see cref="ListAsync"/>) в открытом соединении
    /// </summary>
    /// <param name="connection">Открытое соединение</param>
    /// <param name="transaction">Транзакция, в снимке которой читать; <c>null</c> — без транзакции</param>
    /// <param name="cancellationToken">Отмена чтения</param>
    /// <returns>Определения типов по идентификатору</returns>
    public static async Task<IReadOnlyList<JsonObject>> QueryAsync(
        NpgsqlConnection connection, NpgsqlTransaction? transaction, CancellationToken cancellationToken = default)
    {
        var rows = await connection.QueryAsync<TypeRow>(new CommandDefinition(
            """
            select id as Id, extension_id as ExtensionId, extension_version as ExtensionVersion, definition as Definition
            from types order by id
            """,
            transaction: transaction,
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
