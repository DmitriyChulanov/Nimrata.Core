using System.Text.RegularExpressions;
using Dapper;
using DbUp;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Разделение расширения tracker на tasks и notes на базе, где данные Трекера уже были
/// </summary>
public sealed class TrackerSplitMigrationTests(ServerFactory factory) : IClassFixture<ServerFactory>
{
    private const int LastMigrationBeforeSplit = 19;

    private static readonly string[] NotesTypes = ["NotesRoot", "NoteGroup", "Note", "QuickAccessEntry"];

    private static readonly string[] TasksTypes =
    [
        "TasksRoot", "CurrentTasksRoot", "CompletedTasksRoot", "SelectTodayMechanism",
        "Year", "Month", "Day", "DayOff", "Category", "Task",
    ];

    private static readonly Guid LegacyNotesRootId = Guid.NewGuid();
    private static readonly Guid LegacyTasksRootId = Guid.NewGuid();

    /// <summary>
    /// Применяет к пустой базе только миграции до разделения и записывает данные старого Трекера
    /// </summary>
    /// <param name="database">Строка подключения к новой базе</param>
    private static async Task SeedLegacyTrackerDatabase(string database)
    {
        EnsureDatabase.For.PostgresqlDatabase(database);
        var upgrade = DeployChanges.To
            .PostgresqlDatabase(database)
            .WithScriptsEmbeddedInAssembly(typeof(Startup).Assembly, name =>
            {
                var match = Regex.Match(name, @"\.Migrations\.(\d+)_.*\.sql$");
                return match.Success && int.Parse(match.Groups[1].Value) <= LastMigrationBeforeSplit;
            })
            .Build()
            .PerformUpgrade();
        Assert.True(upgrade.Successful, upgrade.Error?.ToString());

        await using var connection = new NpgsqlConnection(database);
        foreach (var id in NotesTypes.Concat(TasksTypes))
        {
            await connection.ExecuteAsync(
                "insert into types (id, extension_id, extension_version, definition) values (@id, 'tracker', 11, @definition::jsonb)",
                new { id, definition = $$"""{ "id": "{{id}}", "name": "{{id}}" }""" });
        }

        var userId = Guid.NewGuid();
        await connection.ExecuteAsync(
            "insert into users (id, email, password_hash) values (@userId, 'old@example.test', 'x')", new { userId });
        await connection.ExecuteAsync(
            "insert into objects (id, type_id, owner_id) values (@a, 'NotesRoot', @userId), (@b, 'TasksRoot', @userId)",
            new { a = LegacyNotesRootId, b = LegacyTasksRootId, userId });
    }

    /// <summary>
    /// Проверяет, что на базе с данными tracker типы переходят к tasks и notes, а объекты не меняются
    /// </summary>
    [Fact]
    public async Task Startup_DatabaseWithTrackerData_ReassignsTypeOwnersAndKeepsObjects()
    {
        var database = new NpgsqlConnectionStringBuilder(factory.ConnectionString)
        {
            Database = "s" + Guid.NewGuid().ToString("N"),
        }.ConnectionString;
        await SeedLegacyTrackerDatabase(database);

        using var server = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Default"] = database })));
        using var client = server.CreateClient();

        await using var connection = new NpgsqlConnection(database);
        var owners = (await connection.QueryAsync<(string Id, string ExtensionId, int Version)>(
            "select id, extension_id, extension_version from types")).ToList();
        Assert.DoesNotContain(owners, t => t.ExtensionId == "tracker");
        Assert.All(NotesTypes, id => Assert.Equal("notes", owners.Single(t => t.Id == id).ExtensionId));
        Assert.All(TasksTypes, id => Assert.Equal("tasks", owners.Single(t => t.Id == id).ExtensionId));
        // Платформенные типы и упразднённый SelectTodayMechanism манифестами не обновляются
        Assert.All(owners.Where(t => t.ExtensionId is not null && t.Id != "SelectTodayMechanism"),
            t => Assert.True(t.Version > 11, $"{t.Id}: версия {t.Version}"));

        var objects = (await connection.QueryAsync<(Guid Id, string TypeId)>("select id, type_id from objects")).ToList();
        Assert.Contains((LegacyNotesRootId, "NotesRoot"), objects);
        Assert.Contains((LegacyTasksRootId, "TasksRoot"), objects);
        Assert.Equal(2, objects.Count);
    }
}
