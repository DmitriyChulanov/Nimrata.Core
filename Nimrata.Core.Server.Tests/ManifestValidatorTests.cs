using System.Text.Json;
using Nimrata.Core.Server.Modules;

namespace Nimrata.Core.Server.Tests;

/// <summary>Проверка манифестов валидатором; БД и сервер не нужны</summary>
public sealed class ManifestValidatorTests
{
    private static string TrackerManifestPath()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var path = Path.Combine(directory.FullName, "nimrata.core.client", "src", "modules", "tracker", "manifest.json");
            if (File.Exists(path)) return path;
        }
        throw new FileNotFoundException("Манифест Трекера не найден выше каталога тестов.");
    }

    private static List<string> Validate(string json)
    {
        using var document = JsonDocument.Parse(json);
        return ManifestValidator.Validate(document.RootElement);
    }

    [Fact]
    public void TrackerManifest_IsValid()
    {
        var errors = Validate(File.ReadAllText(TrackerManifestPath()));

        Assert.Empty(errors);
    }

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

    private static string WithType(string property) =>
        $$"""{ "module": "demo", "version": 1, "types": [ { "id": "A", "name": "A", "properties": [ {{property}} ] } ] }""";

    [Fact]
    public void RevealTarget_ForReference_IsAllowed()
    {
        var errors = Validate(WithType("""{ "id": "t", "name": "T", "kind": "reference", "revealTarget": true }"""));

        Assert.Empty(errors);
    }

    [Theory]
    [InlineData("""{ "id": "t", "name": "T", "kind": "string", "revealTarget": true }""", "reference")]
    [InlineData("""{ "id": "t", "name": "T", "kind": "reference", "revealTarget": "да" }""", "логическое")]
    public void RevealTarget_Invalid_IsRejected(string property, string substring)
    {
        var errors = Validate(WithType(property));

        Assert.Contains(errors, error => error.Contains("revealTarget") && error.Contains(substring));
    }
}
