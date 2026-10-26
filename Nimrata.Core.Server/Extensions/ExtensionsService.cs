using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Extensions;

/// <summary>
/// Каталог расширений из манифестов и личные подключения пользователя
/// </summary>
/// <param name="dataSource">Источник соединений с БД</param>
public sealed class ExtensionsService(NpgsqlDataSource dataSource)
{
    /// <summary>
    /// Общая часть запросов каталога: поля расширения и состояние подключения пользователя
    /// </summary>
    private const string CatalogQuery = """
        select e.id as Id, e.name as Name, e.description as Description, e.icon as Icon,
               e.default_enabled as DefaultEnabled, is_extension_enabled(@userId, e.id) as Connected
        from extensions e
        """;

    /// <summary>
    /// Каталог расширений с состоянием подключения пользователя
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <param name="cancellationToken">Отмена запроса</param>
    /// <returns>Расширения из манифестов по названию</returns>
    public async Task<IReadOnlyList<ExtensionInfo>> ListAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<ExtensionInfo>(new CommandDefinition(
            $"{CatalogQuery} order by e.name, e.id", new { userId }, cancellationToken: cancellationToken));
        return rows.ToList();
    }

    /// <summary>
    /// Подключает или отключает расширение для пользователя; данные расширения не удаляются
    /// </summary>
    /// <param name="userId">Пользователь, чьё подключение меняется</param>
    /// <param name="extensionId">Идентификатор расширения</param>
    /// <param name="connected">Подключить (<c>true</c>) или отключить</param>
    /// <param name="cancellationToken">Отмена запроса</param>
    /// <returns>Обновлённый элемент каталога или <c>null</c>, если такого расширения нет</returns>
    public async Task<ExtensionInfo?> SetConnectionAsync(
        Guid userId, string extensionId, bool connected, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var inserted = await connection.ExecuteAsync(new CommandDefinition(
            """
            insert into user_extensions (user_id, extension_id, enabled)
            select @userId, id, @connected from extensions where id = @extensionId
            on conflict (user_id, extension_id) do update set enabled = excluded.enabled, updated_at = now()
            """,
            new { userId, extensionId, connected },
            cancellationToken: cancellationToken));
        if (inserted == 0)
        {
            return null;
        }

        return await connection.QuerySingleOrDefaultAsync<ExtensionInfo>(new CommandDefinition(
            $"{CatalogQuery} where e.id = @extensionId", new { userId, extensionId }, cancellationToken: cancellationToken));
    }
}
