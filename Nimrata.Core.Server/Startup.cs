using System.Reflection;
using DbUp;
using Nimrata.Core.Server.Data;

namespace Nimrata.Core.Server;

public static class Startup
{
    /// <summary>Применяет пронумерованные SQL-миграции, встроенные в сборку сервера.</summary>
    public static void ApplyMigrations(string connectionString)
    {
        EnsureDatabase.For.PostgresqlDatabase(connectionString);

        var результат = DeployChanges.To
            .PostgresqlDatabase(connectionString)
            .WithScriptsEmbeddedInAssembly(
                Assembly.GetExecutingAssembly(),
                имя => имя.Contains(".Migrations.") && имя.EndsWith(".sql"))
            .LogToConsole()
            .Build()
            .PerformUpgrade();

        if (!результат.Successful)
        {
            throw new InvalidOperationException("Не удалось применить миграции БД.", результат.Error);
        }
    }
}
