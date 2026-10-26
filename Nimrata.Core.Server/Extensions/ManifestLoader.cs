using System.Text.Json;
using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Extensions;

/// <summary>
/// Читает манифесты расширений (<c>{каталог}/{расширение}/manifest.json</c>) и синхронизирует таблицу типов
/// </summary>
public static class ManifestLoader
{
    /// <summary>
    /// Каталог манифестов по умолчанию: контент сборки сервера
    /// </summary>
    public static string DefaultDirectory => Path.Combine(AppContext.BaseDirectory, "Extensions");

    /// <summary>
    /// Проверяет все манифесты каталога и в одной транзакции записывает типы с более новой версией расширения
    /// </summary>
    /// <param name="connectionString">Строка подключения к БД</param>
    /// <param name="directory">Каталог с манифестами расширений</param>
    /// <exception cref="InvalidOperationException">Каталога нет, манифест невалиден или тип объявлен другим расширением</exception>
    public static void Load(string connectionString, string directory)
    {
        if (!Directory.Exists(directory))
        {
            throw new InvalidOperationException($"Каталог манифестов расширений не найден: {directory}.");
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
        var extensionId = root.GetProperty("extension").GetString()!;
        var version = root.GetProperty("version").GetInt32();

        var currentVersion = connection.ExecuteScalar<int?>(
            "select max(extension_version) from types where extension_id = @extensionId", new { extensionId }, transaction);
        if (currentVersion >= version) return;

        foreach (var type in root.GetProperty("types").EnumerateArray())
        {
            var id = type.GetProperty("id").GetString()!;
            var affectedRows = connection.Execute("""
                insert into types (id, extension_id, extension_version, definition)
                values (@id, @extensionId, @version, @definition)
                on conflict (id) do update
                    set extension_version = excluded.extension_version,
                        definition = excluded.definition,
                        updated_at = now()
                    where types.extension_id = excluded.extension_id
                """, new { id, extensionId, version, definition = type }, transaction);
            if (affectedRows == 0)
            {
                throw new InvalidOperationException(
                    $"Манифест {file}: тип \"{id}\" уже объявлен другим расширением.");
            }
        }
    }
}
