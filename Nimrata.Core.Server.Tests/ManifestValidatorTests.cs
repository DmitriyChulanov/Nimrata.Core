using System.Text.Json;
using Nimrata.Core.Server.Extensions;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Проверка манифестов валидатором; БД и сервер не нужны
/// </summary>
public sealed class ManifestValidatorTests
{
    /// <summary>
    /// Находит манифест Трекера в репозитории
    /// </summary>
    /// <returns>Путь к файлу</returns>
    private static string TrackerManifestPath()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var path = Path.Combine(directory.FullName, "nimrata.core.client", "src", "extensions", "tracker", "manifest.json");
            if (File.Exists(path)) return path;
        }
        throw new FileNotFoundException("Манифест Трекера не найден выше каталога тестов.");
    }

    /// <summary>
    /// Проверяет манифест валидатором
    /// </summary>
    /// <param name="json">JSON манифеста</param>
    /// <returns>Список найденных ошибок</returns>
    private static List<string> Validate(string json)
    {
        using var document = JsonDocument.Parse(json);
        return ManifestValidator.Validate(document.RootElement);
    }

    /// <summary>
    /// Проверяет, что манифест Трекера проходит валидацию
    /// </summary>
    [Fact]
    public void TrackerManifest_IsValid()
    {
        var errors = Validate(File.ReadAllText(TrackerManifestPath()));

        Assert.Empty(errors);
    }

    /// <summary>
    /// Проверяет, что корни задач допускают текущие и выполненные
    /// </summary>
    [Fact]
    public void TrackerManifest_TaskRootsAllowCurrentAndCompleted()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(TrackerManifestPath()));
        var root = document.RootElement.GetProperty("types").EnumerateArray()
            .Single(type => type.GetProperty("id").GetString() == "TasksRoot");

        var children = root.GetProperty("allowedChildren").EnumerateArray().Select(child => child.GetString()).ToList();

        Assert.Contains("CurrentTasksRoot", children);
        Assert.Contains("CompletedTasksRoot", children);
    }

    /// <summary>
    /// Формирует манифест с одним типом и заданным свойством
    /// </summary>
    /// <param name="property">JSON свойства</param>
    /// <returns>JSON манифеста</returns>
    private static string WithType(string property) =>
        $$"""{ "extension": "demo", "version": 1, "types": [ { "id": "A", "name": "A", "properties": [ {{property}} ] } ] }""";

    /// <summary>
    /// Проверяет, что цель показа допустима для свойства-ссылки
    /// </summary>
    [Fact]
    public void RevealTarget_ForReference_IsAllowed()
    {
        var errors = Validate(WithType("""{ "id": "t", "name": "T", "kind": "reference", "revealTarget": true }"""));

        Assert.Empty(errors);
    }

    /// <summary>
    /// Проверяет, что недопустимая цель показа отклоняется
    /// </summary>
    /// <param name="property">JSON свойства</param>
    /// <param name="substring">Фрагмент ожидаемой ошибки</param>
    [Theory]
    [InlineData("""{ "id": "t", "name": "T", "kind": "string", "revealTarget": true }""", "reference")]
    [InlineData("""{ "id": "t", "name": "T", "kind": "reference", "revealTarget": "да" }""", "логическое")]
    public void RevealTarget_Invalid_IsRejected(string property, string substring)
    {
        var errors = Validate(WithType(property));

        Assert.Contains(errors, error => error.Contains("revealTarget") && error.Contains(substring));
    }
}
