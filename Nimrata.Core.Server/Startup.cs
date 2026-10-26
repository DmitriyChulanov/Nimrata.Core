using System.Reflection;
using DbUp;
using Nimrata.Core.Server.Data;

namespace Nimrata.Core.Server;

/// <summary>
/// Действия при старте сервера
/// </summary>
public static class Startup
{
    /// <summary>
    /// Применяет пронумерованные SQL-миграции, встроенные в сборку сервера
    /// </summary>
    public static void ApplyMigrations(string connectionString)
    {
        EnsureDatabase.For.PostgresqlDatabase(connectionString);

        var result = DeployChanges.To
            .PostgresqlDatabase(connectionString)
            .WithScriptsEmbeddedInAssembly(
                Assembly.GetExecutingAssembly(),
                name => name.Contains(".Migrations.") && name.EndsWith(".sql"))
            .LogToConsole()
            .Build()
            .PerformUpgrade();

        if (!result.Successful)
        {
            throw new InvalidOperationException("Не удалось применить миграции БД.", result.Error);
        }
    }
}
