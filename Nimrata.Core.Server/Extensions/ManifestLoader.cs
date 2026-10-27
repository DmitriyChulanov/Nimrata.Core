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

            manifests.Add((file, root));
        }

        var typeOwners = CollectTypeOwners(manifests.Select(m => m.Root));
        foreach (var (file, root) in manifests)
        {
            var own = ExtensionOf(root);
            var others = typeOwners.Where(t => t.Value != own).ToDictionary(t => t.Key, t => t.Value);
            var errors = ManifestValidator.Validate(root, others);
            if (errors.Count > 0)
            {
                throw new InvalidOperationException(
                    $"Манифест {file} невалиден:{Environment.NewLine}  " + string.Join(Environment.NewLine + "  ", errors));
            }
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

    /// <summary>
    /// Идентификатор расширения манифеста или <c>null</c>, если поле не заполнено (ошибку даст валидатор)
    /// </summary>
    private static string? ExtensionOf(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty("extension", out var extension)
            && extension.ValueKind == JsonValueKind.String
                ? extension.GetString()
                : null;

    /// <summary>
    /// Собирает соответствие «идентификатор типа — расширение» по всем манифестам; невалидные части пропускаются
    /// </summary>
    private static Dictionary<string, string> CollectTypeOwners(IEnumerable<JsonElement> roots)
    {
        var owners = new Dictionary<string, string>();
        foreach (var root in roots)
        {
            if (ExtensionOf(root) is not { } extension
                || !root.TryGetProperty("types", out var types) || types.ValueKind != JsonValueKind.Array)
            {
                continue;
            }
            foreach (var type in types.EnumerateArray())
            {
                if (type.ValueKind == JsonValueKind.Object && type.TryGetProperty("id", out var id)
                    && id.ValueKind == JsonValueKind.String)
                {
                    owners.TryAdd(id.GetString()!, extension);
                }
            }
        }
        return owners;
    }

    /// <summary>
    /// Записывает метаданные расширения и, если версия манифеста новее сохранённой, его типы
    /// </summary>
    /// <param name="connection">Открытое соединение</param>
    /// <param name="transaction">Транзакция синхронизации</param>
    /// <param name="file">Путь к манифесту для текста ошибок</param>
    /// <param name="root">Корень проверенного манифеста</param>
    /// <exception cref="InvalidOperationException">Тип уже объявлен другим расширением</exception>
    private static void Sync(NpgsqlConnection connection, NpgsqlTransaction transaction, string file, JsonElement root)
    {
        var extensionId = root.GetProperty("extension").GetString()!;
        var version = root.GetProperty("version").GetInt32();

        // Метаданные и команды расширения берутся из манифеста всегда, независимо от версии типов
        connection.Execute("""
            insert into extensions (id, name, description, icon, default_enabled, commands)
            values (@extensionId, @name, @description, @icon, @defaultEnabled, @commands)
            on conflict (id) do update
                set name = excluded.name,
                    description = excluded.description,
                    icon = excluded.icon,
                    default_enabled = excluded.default_enabled,
                    commands = excluded.commands
            """,
            new
            {
                extensionId,
                name = root.GetProperty("name").GetString(),
                description = root.GetProperty("description").GetString(),
                icon = root.GetProperty("icon").GetString(),
                defaultEnabled = root.GetProperty("defaultEnabled").GetBoolean(),
                commands = root.TryGetProperty("commands", out var commands)
                    ? commands
                    : JsonDocument.Parse("[]").RootElement,
            },
            transaction);

        // Типы применяются только при более новой версии расширения
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
