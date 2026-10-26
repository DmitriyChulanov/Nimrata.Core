using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Чтение объектов пользователя
/// </summary>
public sealed class ObjectsService(NpgsqlDataSource dataSource)
{
    /// <summary>
    /// Все объекты пользователя и только они, кроме объектов типов отключённых у него расширений;
    /// типы платформы (без расширения) видны всегда
    /// </summary>
    public async Task<IReadOnlyList<ObjectRecord>> LoadAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<ObjectRecord>(new CommandDefinition(
            """
            select o.id as Id, o.type_id as Type, o.parent_id as Parent, o.sort_order as "Order", o.properties as Properties
            from objects o
            left join types t on t.id = o.type_id
            where o.owner_id = @userId and is_extension_enabled(@userId, t.extension_id)
            order by o.sort_order, o.id
            """,
            new { userId },
            cancellationToken: cancellationToken));
        return rows.ToList();
    }
}
