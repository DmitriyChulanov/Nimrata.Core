using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Objects;

/// <summary>Чтение журнала изменений; журнал через API не правится</summary>
public sealed class JournalService(NpgsqlDataSource dataSource)
{
    private const string Filter = "c.user_id = @userId and (@objectId::uuid is null or e.object_id = @objectId::uuid)";

    /// <summary>Записи журнала пользователя от новых к старым: все или по одному объекту; чужие записи не возвращаются</summary>
    public async Task<JournalPage> ReadAsync(
        Guid userId, Guid? objectId, int skip, int take, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var parameters = new { userId, objectId, skip, take };

        var total = await connection.ExecuteScalarAsync<long>(new CommandDefinition(
            $"""
            select count(*) from changeset_entries e join changesets c on c.id = e.changeset_id
            where {Filter}
            """,
            parameters,
            cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<JournalEntry>(new CommandDefinition(
            $"""
            select e.id as Id, e.changeset_id as ChangesetId, c.created_at as At, u.email as "User",
                   e.object_id as ObjectId, e.operation as Operation, e.property as Property,
                   e.old_value as Old, e.new_value as New, e.snapshot as Snapshot
            from changeset_entries e
            join changesets c on c.id = e.changeset_id
            join users u on u.id = c.user_id
            where {Filter}
            order by c.created_at desc, e.id desc
            offset @skip limit @take
            """,
            parameters,
            cancellationToken: cancellationToken));

        var items = rows.Select(row => row with { At = DateTime.SpecifyKind(row.At, DateTimeKind.Utc) }).ToList();
        return new JournalPage(items, total);
    }
}
