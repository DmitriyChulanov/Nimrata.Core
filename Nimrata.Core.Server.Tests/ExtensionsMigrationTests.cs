using System.Text.RegularExpressions;
using Dapper;
using DbUp;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Миграция подключений расширений и типа записи журнала на базе, где уже есть данные и журнал
/// </summary>
public sealed class ExtensionsMigrationTests(ServerFactory factory) : IClassFixture<ServerFactory>
{
    private const int LastMigrationBeforeConnections = 20;

    private static readonly Guid LiveTask = Guid.NewGuid();
    private static readonly Guid DeletedNote = Guid.NewGuid();
    private static readonly Guid DeletedBySnapshotOnCreate = Guid.NewGuid();
    private static readonly Guid UnknownObject = Guid.NewGuid();

    /// <summary>
    /// Применяет миграции до подключений и записывает объекты и журнал в старом формате
    /// </summary>
    /// <param name="database">Строка подключения к новой базе</param>
    private static async Task SeedLegacyDatabase(string database)
    {
        EnsureDatabase.For.PostgresqlDatabase(database);
        var upgrade = DeployChanges.To
            .PostgresqlDatabase(database)
            .WithScriptsEmbeddedInAssembly(typeof(Startup).Assembly, name =>
            {
                var match = Regex.Match(name, @"\.Migrations\.(\d+)_.*\.sql$");
                return match.Success && int.Parse(match.Groups[1].Value) <= LastMigrationBeforeConnections;
            })
            .Build()
            .PerformUpgrade();
        Assert.True(upgrade.Successful, upgrade.Error?.ToString());

        await using var connection = new NpgsqlConnection(database);
        await connection.ExecuteAsync(
            """
            insert into types (id, extension_id, extension_version, definition) values
                ('Task', 'tasks', 12, '{ "id": "Task", "name": "Задача" }'::jsonb),
                ('Note', 'notes', 12, '{ "id": "Note", "name": "Заметка" }'::jsonb)
            """);
        var userId = Guid.NewGuid();
        var changesetId = Guid.NewGuid();
        await connection.ExecuteAsync(
            "insert into users (id, email, password_hash) values (@userId, 'old@example.test', 'x')", new { userId });
        await connection.ExecuteAsync("insert into objects (id, type_id, owner_id) values (@LiveTask, 'Task', @userId)",
            new { LiveTask, userId });
        await connection.ExecuteAsync("insert into changesets (id, user_id) values (@changesetId, @userId)",
            new { changesetId, userId });
        await connection.ExecuteAsync(
            """
            insert into changeset_entries (changeset_id, seq, object_id, operation, new_value, snapshot) values
                (@changesetId, 1, @LiveTask, 'create', '{ "type": "Task" }'::jsonb, null),
                (@changesetId, 2, @LiveTask, 'update', '"x"'::jsonb, null),
                (@changesetId, 3, @DeletedNote, 'create', '{ "type": "Note" }'::jsonb, null),
                (@changesetId, 4, @DeletedNote, 'delete', null, '{ "type": "Note" }'::jsonb),
                (@changesetId, 5, @DeletedBySnapshotOnCreate, 'create', '{ "properties": {} }'::jsonb, '{ "type": "Task" }'::jsonb),
                (@changesetId, 6, @DeletedBySnapshotOnCreate, 'delete', null, null),
                (@changesetId, 7, @UnknownObject, 'update', '"y"'::jsonb, null)
            """,
            new { changesetId, LiveTask, DeletedNote, DeletedBySnapshotOnCreate, UnknownObject });
    }

    /// <summary>
    /// Проверяет бэкфилл типа записей журнала, неизменяемость журнала после миграции и пустую таблицу подключений
    /// </summary>
    [Fact]
    public async Task Startup_DatabaseWithJournal_BackfillsEntryTypesAndKeepsJournalImmutable()
    {
        var database = new NpgsqlConnectionStringBuilder(factory.ConnectionString)
        {
            Database = "x" + Guid.NewGuid().ToString("N"),
            Pooling = false,
        }.ConnectionString;
        await SeedLegacyDatabase(database);

        using var server = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Default"] = database })));
        using var client = server.CreateClient();

        await using var connection = new NpgsqlConnection(database);
        var types = (await connection.QueryAsync<(Guid ObjectId, string Operation, string? TypeId)>(
            "select object_id, operation, type_id from changeset_entries order by seq")).ToList();
        Assert.Equal(
            [
                (LiveTask, "create", "Task"), (LiveTask, "update", "Task"),
                (DeletedNote, "create", "Note"), (DeletedNote, "delete", "Note"),
                (DeletedBySnapshotOnCreate, "create", "Task"), (DeletedBySnapshotOnCreate, "delete", "Task"),
                (UnknownObject, "update", null),
            ],
            types);

        var immutable = await Assert.ThrowsAsync<PostgresException>(() =>
            connection.ExecuteAsync("update changeset_entries set type_id = null"));
        Assert.Contains("неизменяем", immutable.MessageText);
        Assert.Equal(0, await connection.ExecuteScalarAsync<long>("select count(*) from user_extensions"));
        var catalog = (await connection.QueryAsync<string>("select id from extensions order by id")).ToList();
        Assert.Equal(["notes", "tasks"], catalog);
        Assert.Equal(7, await connection.ExecuteScalarAsync<long>("select count(*) from changeset_entries"));
    }
}
