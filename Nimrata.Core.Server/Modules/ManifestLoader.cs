using System.Text.Json;
using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Modules;

/// <summary>Читает манифесты модулей (<c>{каталог}/{модуль}/manifest.json</c>) и синхронизирует таблицу типов</summary>
public static class ManifestLoader
{
    /// <summary>Каталог манифестов по умолчанию: контент сборки сервера</summary>
    public static string DefaultDirectory => Path.Combine(AppContext.BaseDirectory, "Modules");

    /// <summary>Проверяет все манифесты каталога и в одной транзакции записывает типы с более новой версией модуля</summary>
    /// <param name="connectionString">Строка подключения к БД</param>
    /// <param name="directory">Каталог с манифестами модулей</param>
    /// <exception cref="InvalidOperationException">Каталога нет, манифест невалиден или тип объявлен другим модулем</exception>
    public static void Load(string connectionString, string directory)
    {
        if (!Directory.Exists(directory))
        {
            throw new InvalidOperationException($"Каталог манифестов модулей не найден: {directory}.");
        }

        var manifests = new List<(string File, JsonElement Root)>();
        foreach (var file in Directory.EnumerateFiles(directory, "manifest.json", SearchOption.AllDirectories).Order())
        {
            JsonElement root;
            try
            {
                using var document = JsonDocument.Parse(File.ReadAllText(file));
                root = document.RootElement.Clone();
            }
            catch (JsonException e)
            {
                throw new InvalidOperationException($"Манифест {file}: некорректный JSON ({e.Message}).", e);
            }

            var errors = ManifestValidator.Validate(root);
            if (errors.Count > 0)
            {
                throw new InvalidOperationException(
                    $"Манифест {file} невалиден:{Environment.NewLine}  " + string.Join(Environment.NewLine + "  ", errors));
            }
            manifests.Add((file, root));
        }

        using var connection = new NpgsqlConnection(connectionString);
        connection.Open();
        using var transaction = connection.BeginTransaction();
        foreach (var (file, root) in manifests)
        {
            Sync(connection, transaction, file, root);
        }
        transaction.Commit();
    }

    private static void Sync(NpgsqlConnection connection, NpgsqlTransaction transaction, string file, JsonElement root)
    {
        var moduleId = root.GetProperty("module").GetString()!;
        var version = root.GetProperty("version").GetInt32();

        var currentVersion = connection.ExecuteScalar<int?>(
            "select max(module_version) from types where module_id = @moduleId", new { moduleId }, transaction);
        if (currentVersion >= version) return;

        foreach (var type in root.GetProperty("types").EnumerateArray())
        {
            var id = type.GetProperty("id").GetString()!;
            var affectedRows = connection.Execute("""
                insert into types (id, module_id, module_version, definition)
                values (@id, @moduleId, @version, @definition)
                on conflict (id) do update
                    set module_version = excluded.module_version,
                        definition = excluded.definition,
                        updated_at = now()
                    where types.module_id = excluded.module_id
                """, new { id, moduleId, version, definition = type }, transaction);
            if (affectedRows == 0)
            {
                throw new InvalidOperationException(
                    $"Манифест {file}: тип \"{id}\" уже объявлен другим модулем.");
            }
        }
    }
}
