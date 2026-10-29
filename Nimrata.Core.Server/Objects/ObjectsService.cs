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
    /// <param name="userId">Владелец объектов</param>
    /// <param name="cancellationToken">Отмена чтения</param>
    /// <returns>Видимые объекты пользователя по номеру</returns>
    public async Task<IReadOnlyList<ObjectRecord>> LoadAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await QueryVisibleAsync(connection, null, userId, null, cancellationToken);
    }

    /// <summary>
    /// Видимые объекты пользователя (фильтр как у <see cref="LoadAsync"/>) в открытом соединении
    /// </summary>
    /// <param name="connection">Открытое соединение</param>
    /// <param name="transaction">Транзакция, в снимке которой читать; <c>null</c> — без транзакции</param>
    /// <param name="userId">Владелец объектов</param>
    /// <param name="ids">Только эти объекты; <c>null</c> — все</param>
    /// <param name="cancellationToken">Отмена чтения</param>
    /// <returns>Видимые объекты по номеру</returns>
    public static async Task<IReadOnlyList<ObjectRecord>> QueryVisibleAsync(
        NpgsqlConnection connection, NpgsqlTransaction? transaction, Guid userId, Guid[]? ids,
        CancellationToken cancellationToken = default)
    {
        var rows = await connection.QueryAsync<ObjectRecord>(new CommandDefinition(
            """
            select o.id as Id, o.type_id as Type, o.parent_id as Parent, o.number as "Number", o.properties as Properties
            from objects o
            left join types t on t.id = o.type_id
            where o.owner_id = @userId and is_extension_enabled(@userId, t.extension_id)
              and (@ids::uuid[] is null or o.id = any(@ids::uuid[]))
            order by o.number, o.id
            """,
            new { userId, ids },
            transaction,
            cancellationToken: cancellationToken));
        return rows.ToList();
    }
}
