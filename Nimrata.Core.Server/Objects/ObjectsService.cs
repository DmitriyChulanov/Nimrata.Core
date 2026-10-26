using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Чтение объектов пользователя
/// </summary>
public sealed class ObjectsService(NpgsqlDataSource dataSource)
{
    /// <summary>
    /// Все объекты пользователя и только они
    /// </summary>
    public async Task<IReadOnlyList<ObjectRecord>> LoadAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<ObjectRecord>(new CommandDefinition(
            """
            select id as Id, type_id as Type, parent_id as Parent, sort_order as "Order", properties as Properties
            from objects where owner_id = @userId order by sort_order, id
            """,
            new { userId },
            cancellationToken: cancellationToken));
        return rows.ToList();
    }
}
