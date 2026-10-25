using System.Text.Json;
using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Modules;

/// <summary>Читает манифесты модулей (<c>{каталог}/{модуль}/manifest.json</c>) и синхронизирует таблицу типов.</summary>
public static class ManifestLoader
{
    /// <summary>Каталог манифестов по умолчанию: контент сборки сервера.</summary>
    public static string КаталогПоУмолчанию => Path.Combine(AppContext.BaseDirectory, "Modules");

    public static void Загрузить(string connectionString, string каталог)
    {
        if (!Directory.Exists(каталог))
        {
            throw new InvalidOperationException($"Каталог манифестов модулей не найден: {каталог}.");
        }

        var манифесты = new List<(string Файл, JsonElement Корень)>();
        foreach (var файл in Directory.EnumerateFiles(каталог, "manifest.json", SearchOption.AllDirectories).Order())
        {
            JsonElement корень;
            try
            {
                using var документ = JsonDocument.Parse(File.ReadAllText(файл));
                корень = документ.RootElement.Clone();
            }
            catch (JsonException e)
            {
                throw new InvalidOperationException($"Манифест {файл}: некорректный JSON ({e.Message}).", e);
            }

            var ошибки = ManifestValidator.Validate(корень);
            if (ошибки.Count > 0)
            {
                throw new InvalidOperationException(
                    $"Манифест {файл} невалиден:{Environment.NewLine}  " + string.Join(Environment.NewLine + "  ", ошибки));
            }
            манифесты.Add((файл, корень));
        }

        using var соединение = new NpgsqlConnection(connectionString);
        соединение.Open();
        using var транзакция = соединение.BeginTransaction();
        foreach (var (файл, корень) in манифесты)
        {
            Синхронизировать(соединение, транзакция, файл, корень);
        }
        транзакция.Commit();
    }

    private static void Синхронизировать(NpgsqlConnection соединение, NpgsqlTransaction транзакция, string файл, JsonElement корень)
    {
        var модуль = корень.GetProperty("module").GetString()!;
        var версия = корень.GetProperty("version").GetInt32();

        var текущая = соединение.ExecuteScalar<int?>(
            "select max(module_version) from types where module_id = @модуль", new { модуль }, транзакция);
        if (текущая >= версия) return;

        foreach (var тип in корень.GetProperty("types").EnumerateArray())
        {
            var id = тип.GetProperty("id").GetString()!;
            var строк = соединение.Execute("""
                insert into types (id, module_id, module_version, definition)
                values (@id, @модуль, @версия, @определение)
                on conflict (id) do update
                    set module_version = excluded.module_version,
                        definition = excluded.definition,
                        updated_at = now()
                    where types.module_id = excluded.module_id
                """, new { id, модуль, версия, определение = тип }, транзакция);
            if (строк == 0)
            {
                throw new InvalidOperationException(
                    $"Манифест {файл}: тип \"{id}\" уже объявлен другим модулем.");
            }
        }
    }
}
