using System.Data;
using Dapper;
using Microsoft.Extensions.Options;
using Nimrata.Core.Server.Objects;
using Npgsql;

namespace Nimrata.Core.Server.Sync;

/// <summary>
/// Чтение для синхронизации: догон с курсора и согласованная полная загрузка. Источник изменений — журнал
/// (<c>changesets</c>/<c>changeset_entries</c>), финальное состояние — таблица <c>objects</c>
/// </summary>
public sealed class SyncService(NpgsqlDataSource dataSource, IOptions<SyncOptions> options)
{
    /// <summary>
    /// Изменения пользователя после курсора в одном снимке БД
    /// </summary>
    /// <param name="userId">Пользователь, чьи наборы и объекты читаются</param>
    /// <param name="since">Курсор клиента: <c>seq</c> последнего известного ему набора (0 — ничего не известно)</param>
    /// <param name="cancellationToken">Отмена чтения</param>
    /// <returns>
    /// Изменения после курсора либо <c>null</c>, если клиенту нужно перечитать всё (resync): наборов больше порога
    /// <see cref="SyncOptions.ResyncThreshold"/> или курсор новее последнего набора пользователя (БД пересоздана)
    /// </returns>
    /// <exception cref="ArgumentOutOfRangeException">Курсор отрицательный</exception>
    public async Task<ChangesBatch?> ReadChangesAsync(Guid userId, long since, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(since);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await BeginSnapshotAsync(connection, cancellationToken);

        var last = await LastSeqAsync(connection, transaction, userId, cancellationToken);
        if (since > last)
        {
            return null;
        }

        var threshold = options.Value.ResyncThreshold;
        var changesetIds = (await connection.QueryAsync<Guid>(new CommandDefinition(
            "select id from changesets where user_id = @userId and seq > @since order by seq limit @limit",
            new { userId, since, limit = (long)threshold + 1 },
            transaction,
            cancellationToken: cancellationToken))).ToList();
        if (changesetIds.Count > threshold)
        {
            return null;
        }

        var touched = (await connection.QueryAsync<Guid>(new CommandDefinition(
            """
            select distinct e.object_id
            from changeset_entries e
            join changesets c on c.id = e.changeset_id
            where c.user_id = @userId and c.seq > @since
            """,
            new { userId, since },
            transaction,
            cancellationToken: cancellationToken))).ToArray();
        var upserts = touched.Length == 0
            ? []
            : await ObjectsService.QueryVisibleAsync(connection, transaction, userId, touched, cancellationToken);
        var visible = upserts.Select(o => o.Id).ToHashSet();
        var deletes = touched.Where(id => !visible.Contains(id)).Order().ToList();

        await transaction.CommitAsync(cancellationToken);
        return new ChangesBatch(last, changesetIds, upserts, deletes);
    }

    /// <summary>
    /// Полная загрузка: типы, видимые объекты и курсор, прочитанные в одном снимке БД
    /// </summary>
    /// <param name="userId">Пользователь, чьи объекты читаются</param>
    /// <param name="cancellationToken">Отмена чтения</param>
    /// <returns>Снимок с курсором, с которого клиент продолжает догон</returns>
    public async Task<SyncSnapshot> ReadSnapshotAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await BeginSnapshotAsync(connection, cancellationToken);

        var seq = await LastSeqAsync(connection, transaction, userId, cancellationToken);
        var types = await TypesService.QueryAsync(connection, transaction, cancellationToken);
        var objects = await ObjectsService.QueryVisibleAsync(connection, transaction, userId, null, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return new SyncSnapshot(seq, types, objects);
    }

    /// <summary>
    /// Транзакция только для чтения в одном снимке (<c>repeatable read</c>): курсор и данные согласованы
    /// </summary>
    /// <param name="connection">Открытое соединение</param>
    /// <param name="cancellationToken">Отмена</param>
    /// <returns>Начатая транзакция</returns>
    private static async Task<NpgsqlTransaction> BeginSnapshotAsync(NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        var transaction = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            "set transaction read only", transaction: transaction, cancellationToken: cancellationToken));
        return transaction;
    }

    /// <summary>
    /// <c>seq</c> последнего зафиксированного набора пользователя в снимке
    /// </summary>
    /// <param name="connection">Открытое соединение</param>
    /// <param name="transaction">Транзакция снимка</param>
    /// <param name="userId">Автор наборов</param>
    /// <param name="cancellationToken">Отмена</param>
    /// <returns>Курсор; 0 — наборов нет</returns>
    private static Task<long> LastSeqAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, Guid userId, CancellationToken cancellationToken) =>
        connection.ExecuteScalarAsync<long>(new CommandDefinition(
            "select coalesce(max(seq), 0) from changesets where user_id = @userId",
            new { userId },
            transaction,
            cancellationToken: cancellationToken));
}
