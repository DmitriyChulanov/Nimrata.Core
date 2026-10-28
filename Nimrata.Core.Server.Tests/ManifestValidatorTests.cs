using System.Text.Json;
using Nimrata.Core.Server.Extensions;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Проверка манифестов валидатором; БД и сервер не нужны
/// </summary>
public sealed class ManifestValidatorTests
{
    /// <summary>
    /// Находит манифест расширения в репозитории
    /// </summary>
    /// <param name="extension">Идентификатор расширения</param>
    /// <returns>Путь к файлу</returns>
    private static string ManifestPath(string extension)
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var path = Path.Combine(directory.FullName, "nimrata.core.client", "src", "extensions", extension, "manifest.json");
            if (File.Exists(path)) return path;
        }
        throw new FileNotFoundException($"Манифест расширения {extension} не найден выше каталога тестов.");
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
    /// Проверяет, что манифест расширения проходит валидацию
    /// </summary>
    /// <param name="extension">Идентификатор расширения</param>
    [Theory]
    [InlineData("tasks")]
    [InlineData("notes")]
    public void ExtensionManifest_IsValid(string extension)
    {
        var errors = Validate(File.ReadAllText(ManifestPath(extension)));

        Assert.Empty(errors);
    }

    /// <summary>
    /// Проверяет, что корни задач допускают текущие и выполненные
    /// </summary>
    [Fact]
    public void TasksManifest_TaskRootsAllowCurrentAndCompleted()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(ManifestPath("tasks")));
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
        $$"""{ "extension": "demo", "version": 1, "name": "Демо", "description": "Описание", "icon": "star", "defaultEnabled": true, "types": [ { "id": "A", "name": "A", "properties": [ {{property}} ] } ] }""";

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

    /// <summary>
    /// Формирует манифест с заданными метаданными расширения и одним типом
    /// </summary>
    /// <param name="metadata">JSON полей метаданных (без внешних фигурных скобок)</param>
    /// <param name="type">JSON типа</param>
    /// <returns>JSON манифеста</returns>
    private static string WithMetadata(string metadata, string type = """{ "id": "A", "name": "A" }""") =>
        $$"""{ "extension": "demo", "version": 1, {{metadata}}, "types": [ {{type}} ] }""";

    /// <summary>
    /// Проверяет, что манифест с полными метаданными проходит проверку
    /// </summary>
    [Fact]
    public void Metadata_Complete_IsAccepted()
    {
        var errors = Validate(WithMetadata(
            """ "name": "Демо", "description": "Описание", "icon": "star", "defaultEnabled": false """));

        Assert.Empty(errors);
    }

    /// <summary>
    /// Проверяет, что каждое поле метаданных расширения обязательно и имеет нужный вид
    /// </summary>
    /// <param name="metadata">JSON полей метаданных</param>
    /// <param name="field">Поле, на которое ожидается ошибка</param>
    [Theory]
    [InlineData(""" "description": "Описание", "icon": "star", "defaultEnabled": true """, "name")]
    [InlineData(""" "name": "", "description": "Описание", "icon": "star", "defaultEnabled": true """, "name")]
    [InlineData(""" "name": "Демо", "icon": "star", "defaultEnabled": true """, "description")]
    [InlineData(""" "name": "Демо", "description": "Описание", "defaultEnabled": true """, "icon")]
    [InlineData(""" "name": "Демо", "description": "Описание", "icon": "  ", "defaultEnabled": true """, "icon")]
    [InlineData(""" "name": "Демо", "description": "Описание", "icon": "star" """, "defaultEnabled")]
    [InlineData(""" "name": "Демо", "description": "Описание", "icon": "star", "defaultEnabled": "да" """, "defaultEnabled")]
    public void Metadata_MissingOrInvalid_IsRejected(string metadata, string field)
    {
        var errors = Validate(WithMetadata(metadata));

        Assert.Contains(errors, error => error.StartsWith($"$.{field}:"));
    }

    /// <summary>
    /// Проверяет, что singleton должен быть логическим значением
    /// </summary>
    [Fact]
    public void Singleton_NotBoolean_IsRejected()
    {
        var errors = Validate(WithMetadata(
            """ "name": "Демо", "description": "Описание", "icon": "star", "defaultEnabled": true """,
            """{ "id": "A", "name": "A", "singleton": "да" }"""));

        Assert.Contains(errors, error => error.Contains("singleton") && error.Contains("логическое"));
    }

    /// <summary>
    /// Проверяет, что singleton принимается как логическое значение
    /// </summary>
    [Fact]
    public void Singleton_Boolean_IsAccepted()
    {
        var errors = Validate(WithMetadata(
            """ "name": "Демо", "description": "Описание", "icon": "star", "defaultEnabled": true """,
            """{ "id": "A", "name": "A", "singleton": true }"""));

        Assert.Empty(errors);
    }

    /// <summary>
    /// Проверяет, что тип расширения не может допускать потомком тип другого расширения
    /// </summary>
    [Fact]
    public void AllowedChildren_TypeOfOtherExtension_IsRejected()
    {
        using var document = JsonDocument.Parse(WithMetadata(
            """ "name": "Демо", "description": "Описание", "icon": "star", "defaultEnabled": true """,
            """{ "id": "A", "name": "A", "allowedChildren": ["Foreign"] }"""));
        var others = new Dictionary<string, string> { ["Foreign"] = "other" };

        var errors = ManifestValidator.Validate(document.RootElement, others);

        Assert.Contains(errors, error => error.Contains("allowedChildren") && error.Contains("другому расширению")
            && error.Contains("other"));
    }

    /// <summary>
    /// Проверяет, что потомки из того же расширения при наличии чужих типов в каталоге допустимы
    /// </summary>
    [Fact]
    public void AllowedChildren_TypeOfSameExtension_IsAcceptedWithOtherExtensionsKnown()
    {
        using var document = JsonDocument.Parse(WithMetadata(
            """ "name": "Демо", "description": "Описание", "icon": "star", "defaultEnabled": true """,
            """{ "id": "A", "name": "A", "allowedChildren": ["A"] }"""));
        var others = new Dictionary<string, string> { ["Foreign"] = "other" };

        var errors = ManifestValidator.Validate(document.RootElement, others);

        Assert.Empty(errors);
    }

    /// <summary>
    /// Проверяет, что манифесты tasks и notes объявляют singleton на автосоздаваемых типах
    /// </summary>
    /// <param name="extension">Идентификатор расширения</param>
    /// <param name="singletons">Типы, которые должны быть singleton</param>
    [Theory]
    [InlineData("tasks", "TasksRoot,CurrentTasksRoot,CompletedTasksRoot,TasksSettings,CategoryTemplates")]
    [InlineData("notes", "NotesRoot,ActiveNotesRoot,CompletedNotesRoot")]
    public void ExtensionManifest_AutoCreatedTypesAreSingleton(string extension, string singletons)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(ManifestPath(extension)));

        var actual = document.RootElement.GetProperty("types").EnumerateArray()
            .Where(type => type.TryGetProperty("singleton", out var flag) && flag.GetBoolean())
            .Select(type => type.GetProperty("id").GetString()!)
            .Order()
            .ToArray();

        Assert.Equal(singletons.Split(',').Order().ToArray(), actual);
    }

    /// <summary>
    /// Проверяет, что у манифестов tasks и notes заданы метаданные для каталога
    /// </summary>
    /// <param name="extension">Идентификатор расширения</param>
    /// <param name="name">Ожидаемое название</param>
    [Theory]
    [InlineData("tasks", "Трекер задач")]
    [InlineData("notes", "Трекер заметок")]
    public void ExtensionManifest_HasCatalogMetadata(string extension, string name)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(ManifestPath(extension)));
        var root = document.RootElement;

        Assert.Equal(name, root.GetProperty("name").GetString());
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("description").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("icon").GetString()));
        Assert.True(root.GetProperty("defaultEnabled").GetBoolean());
    }

    private const string Meta = """ "name": "Демо", "description": "Описание", "icon": "star", "defaultEnabled": true """;

    /// <summary>
    /// Формирует манифест с одним типом и заданной секцией команд
    /// </summary>
    /// <param name="commands">JSON массива команд</param>
    /// <returns>JSON манифеста</returns>
    private static string WithCommands(string commands) =>
        $$"""{ "extension": "demo", "version": 1, {{Meta}}, "types": [ { "id": "A", "name": "A" } ], "commands": {{commands}} }""";

    /// <summary>
    /// Проверяет, что корректные команды (с параметрами и шаблоном) принимаются
    /// </summary>
    [Fact]
    public void Commands_Valid_AreAccepted()
    {
        var errors = Validate(WithCommands(
            """
            [
              { "id": "a", "name": "Команда", "icon": "star", "description": "Описание" },
              { "id": "b", "name": "С параметрами", "icon": "star", "template": true,
                "parameters": [ { "id": "p", "name": "П", "kind": "reference", "targetTypes": ["A"], "required": true } ] }
            ]
            """));

        Assert.Empty(errors);
    }

    /// <summary>
    /// Проверяет, что манифест без секции команд остаётся валидным
    /// </summary>
    [Fact]
    public void Commands_Absent_IsAccepted()
    {
        Assert.Empty(Validate(WithMetadata(Meta)));
    }

    /// <summary>
    /// Проверяет, что неверные команды отклоняются с путём к полю
    /// </summary>
    /// <param name="commands">JSON команд</param>
    /// <param name="expected">Ожидаемый фрагмент ошибки</param>
    [Theory]
    [InlineData("""{ }""", "$.commands: нужен массив")]
    [InlineData("""[ 5 ]""", "$.commands[0]: команда должна быть объектом")]
    [InlineData("""[ { "name": "Н", "icon": "star" } ]""", "$.commands[0].id:")]
    [InlineData("""[ { "id": "a", "icon": "star" } ]""", "$.commands[0].name:")]
    [InlineData("""[ { "id": "a", "name": "Н" } ]""", "$.commands[0].icon:")]
    [InlineData("""[ { "id": "a", "name": "Н", "icon": "star" }, { "id": "a", "name": "Н2", "icon": "star" } ]""", "$.commands[1].id: команда \"a\" повторяется")]
    [InlineData("""[ { "id": "a", "name": "Н", "icon": "star", "description": 1 } ]""", "$.commands[0].description:")]
    [InlineData("""[ { "id": "a", "name": "Н", "icon": "star", "template": "да" } ]""", "$.commands[0].template: нужно логическое значение")]
    [InlineData("""[ { "id": "a", "name": "Н", "icon": "star", "parameters": {} } ]""", "$.commands[0].parameters: нужен массив")]
    [InlineData("""[ { "id": "a", "name": "Н", "icon": "star", "parameters": [ { "id": "p", "name": "П", "kind": "nope" } ] } ]""", "$.commands[0].parameters[0].kind:")]
    [InlineData("""[ { "id": "a", "name": "Н", "icon": "star", "parameters": [ { "id": "p", "name": "П", "kind": "string" }, { "id": "p", "name": "П2", "kind": "string" } ] } ]""", "$.commands[0].parameters[1].id:")]
    public void Commands_Invalid_AreRejected(string commands, string expected)
    {
        var errors = Validate(WithCommands(commands));

        Assert.Contains(errors, error => error.Contains(expected));
    }

    /// <summary>
    /// Проверяет, что иконка действия должна быть строкой, а строковая принимается
    /// </summary>
    [Fact]
    public void ActionIcon_MustBeString()
    {
        var bad = Validate(WithMetadata(Meta, """{ "id": "A", "name": "A", "actions": [ { "id": "x", "name": "X", "icon": 5 } ] }"""));
        var good = Validate(WithMetadata(Meta, """{ "id": "A", "name": "A", "actions": [ { "id": "x", "name": "X", "icon": "plus" } ] }"""));

        Assert.Contains(bad, error => error.Contains("$.types[0].actions[0].icon:"));
        Assert.DoesNotContain(good, error => error.Contains("icon"));
    }

    /// <summary>
    /// Проверяет, что упразднённые флаг типа и место показа «automation» отклоняются
    /// </summary>
    /// <param name="type">JSON типа</param>
    /// <param name="expected">Фрагмент ошибки</param>
    [Theory]
    [InlineData("""{ "id": "A", "name": "A", "automation": true }""", "$.types[0].automation:")]
    [InlineData("""{ "id": "A", "name": "A", "actions": [ { "id": "x", "name": "X", "placements": ["automation"] } ] }""", "неизвестное место \"automation\"")]
    public void Automation_FlagAndPlacement_AreRejected(string type, string expected)
    {
        var errors = Validate(WithMetadata(Meta, type));

        Assert.Contains(errors, error => error.Contains(expected));
    }

    /// <summary>
    /// Проверяет, что манифест задач объявляет команду «Выделить текущий день» без механизма
    /// </summary>
    [Fact]
    public void TasksManifest_DeclaresSelectTodayCommandWithoutMechanism()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(ManifestPath("tasks")));
        var root = document.RootElement;

        var command = root.GetProperty("commands").EnumerateArray()
            .Single(c => c.GetProperty("id").GetString() == "selectToday");
        Assert.Equal("Выделить текущий день", command.GetProperty("name").GetString());
        Assert.DoesNotContain(root.GetProperty("types").EnumerateArray(),
            type => type.GetProperty("id").GetString() == "SelectTodayMechanism");
    }
}
