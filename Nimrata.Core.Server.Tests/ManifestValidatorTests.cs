using System.Text.Json;
using Nimrata.Core.Server.Modules;

namespace Nimrata.Core.Server.Tests;

/// <summary>Проверка манифестов валидатором; БД и сервер не нужны.</summary>
public sealed class ManifestValidatorTests
{
    private static string ПутьКМанифестуТрекера()
    {
        for (var каталог = new DirectoryInfo(AppContext.BaseDirectory); каталог is not null; каталог = каталог.Parent)
        {
            var путь = Path.Combine(каталог.FullName, "nimrata.core.client", "src", "modules", "tracker", "manifest.json");
            if (File.Exists(путь)) return путь;
        }
        throw new FileNotFoundException("Манифест Трекера не найден выше каталога тестов.");
    }

    private static List<string> Проверить(string json)
    {
        using var документ = JsonDocument.Parse(json);
        return ManifestValidator.Validate(документ.RootElement);
    }

    [Fact]
    public void МанифестТрекера_Валиден()
    {
        var ошибки = Проверить(File.ReadAllText(ПутьКМанифестуТрекера()));

        Assert.Empty(ошибки);
    }

    [Fact]
    public void МанифестТрекера_КорниЗадачРазрешаютТекущиеИЗавершённые()
    {
        using var документ = JsonDocument.Parse(File.ReadAllText(ПутьКМанифестуТрекера()));
        var корень = документ.RootElement.GetProperty("types").EnumerateArray()
            .Single(т => т.GetProperty("id").GetString() == "TasksRoot");

        var дети = корень.GetProperty("allowedChildren").EnumerateArray().Select(д => д.GetString()).ToList();

        Assert.Contains("CurrentTasksRoot", дети);
        Assert.Contains("CompletedTasksRoot", дети);
    }

    private static string СТипом(string свойство) =>
        $$"""{ "module": "demo", "version": 1, "types": [ { "id": "A", "name": "A", "properties": [ {{свойство}} ] } ] }""";

    [Fact]
    public void RevealTarget_ДляСсылки_Допустим()
    {
        var ошибки = Проверить(СТипом("""{ "id": "t", "name": "T", "kind": "reference", "revealTarget": true }"""));

        Assert.Empty(ошибки);
    }

    [Theory]
    [InlineData("""{ "id": "t", "name": "T", "kind": "string", "revealTarget": true }""", "reference")]
    [InlineData("""{ "id": "t", "name": "T", "kind": "reference", "revealTarget": "да" }""", "логическое")]
    public void RevealTarget_Некорректный_Отклоняется(string свойство, string подстрока)
    {
        var ошибки = Проверить(СТипом(свойство));

        Assert.Contains(ошибки, о => о.Contains("revealTarget") && о.Contains(подстрока));
    }
}
