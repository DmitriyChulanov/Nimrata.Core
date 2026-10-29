using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Nimrata.Core.Server.Controllers.Responses;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Контракт Набора изменений: общие с клиентом JSON-сценарии (<c>contracts/changeset</c>) против реального сервера.
/// Сравниваются признак успеха (набор применён) и машинный код отказа, текст причины не сравнивается
/// </summary>
public sealed class ChangesetContractTests(ServerFactory factory) : IClassFixture<ServerFactory>, IAsyncLifetime
{
    private static readonly string ContractDirectory = Path.Combine(AppContext.BaseDirectory, "contracts", "changeset");

    private string _directory = null!;
    private string _database = null!;
    private string _extension = null!;
    private WebApplicationFactory<Program> _server = null!;
    private HttpClient _me = null!;
    private Guid _ownerId;

    /// <summary>
    /// Поднимает сервер с расширением из <c>types.json</c> и входит администратором
    /// </summary>
    /// <returns>Задача подготовки</returns>
    public async Task InitializeAsync()
    {
        var typesFile = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(ContractDirectory, "types.json")))!.AsObject();
        _extension = typesFile["extension"]!.GetValue<string>();
        var manifest = new JsonObject
        {
            ["extension"] = _extension,
            ["version"] = 1,
            ["name"] = "Контракт",
            ["description"] = "Типы сценариев контракта Набора изменений",
            ["icon"] = "star",
            ["defaultEnabled"] = true,
            ["types"] = typesFile["types"]!.DeepClone(),
        };

        _directory = Path.Combine(Path.GetTempPath(), "nimrata-contract-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(_directory, _extension));
        await File.WriteAllTextAsync(Path.Combine(_directory, _extension, "manifest.json"), manifest.ToJsonString());
        _database = new NpgsqlConnectionStringBuilder(factory.ConnectionString)
            { Database = "c" + Guid.NewGuid().ToString("N"), Pooling = false }.ConnectionString;
        _server = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = _database,
                ["Extensions:Path"] = _directory,
            })));

        _me = _server.CreateClient();
        var login = await _me.PostAsJsonAsync(
            "/api/auth/login", new { email = ServerFactory.AdminEmail, password = ServerFactory.AdminPassword });
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        _me.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        await using var connection = new NpgsqlConnection(_database);
        _ownerId = await connection.ExecuteScalarAsync<Guid>("select id from users where email = @email", new { email = ServerFactory.AdminEmail });
    }

    /// <summary>
    /// Освобождает ресурсы теста
    /// </summary>
    /// <returns>Завершённая задача</returns>
    public Task DisposeAsync()
    {
        _me?.Dispose();
        _server?.Dispose();
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
        return Task.CompletedTask;
    }

    /// <summary>
    /// Пары «файл сценариев, название сценария» из <c>contracts/changeset</c>
    /// </summary>
    public static TheoryData<string, string> Scenarios
    {
        get
        {
            var data = new TheoryData<string, string>();
            foreach (var path in Directory.GetFiles(ContractDirectory, "*.json").Order())
            {
                if (Path.GetFileName(path) == "types.json") continue;
                foreach (var scenario in ReadScenarios(path))
                {
                    data.Add(Path.GetFileName(path), scenario["name"]!.GetValue<string>());
                }
            }
            return data;
        }
    }

    /// <summary>
    /// Проверяет, что сервер даёт на сценарий тот же признак успеха и код ошибки, что ожидает контракт
    /// </summary>
    /// <param name="file">Файл сценариев</param>
    /// <param name="name">Название сценария</param>
    /// <returns>Задача проверки</returns>
    [Theory]
    [MemberData(nameof(Scenarios))]
    public async Task Scenario_ServerAnswersAsContractExpects(string file, string name)
    {
        var scenario = ReadScenarios(Path.Combine(ContractDirectory, file)).Single(s => s["name"]!.GetValue<string>() == name);
        await ResetAsync(scenario);

        var operations = scenario["operations"]!.AsArray().Select(o => (object)o!.DeepClone()).ToArray();
        var result = await ChangesetApi.ApplyAsync(_me, operations);

        var expect = scenario["expect"]!.AsObject();
        var actual = new JsonObject { ["ok"] = result.IsApplied };
        if (!result.IsApplied && result.Code is not null)
        {
            actual["code"] = result.Code;
        }
        Assert.Equal(expect.ToJsonString(), actual.ToJsonString());
    }

    private static IEnumerable<JsonObject> ReadScenarios(string path) =>
        JsonNode.Parse(File.ReadAllText(path))!["scenarios"]!.AsArray().Select(s => s!.AsObject());

    /// <summary>
    /// Приводит сервер к начальному состоянию сценария: подключение расширения и объекты
    /// </summary>
    private async Task ResetAsync(JsonObject scenario)
    {
        await using (var connection = new NpgsqlConnection(_database))
        {
            await connection.ExecuteAsync("delete from changeset_entries; delete from changesets; delete from objects;");
            foreach (var seed in scenario["objects"]!.AsArray())
            {
                await connection.ExecuteAsync(
                    """
                    insert into objects (id, type_id, parent_id, owner_id, number, properties)
                    values (@id, @type, @parent, @owner, @number, cast(@properties as jsonb))
                    """,
                    new
                    {
                        id = seed!["id"]!.GetValue<Guid>(),
                        type = seed["type"]!.GetValue<string>(),
                        parent = seed["parent"]?.GetValue<Guid>(),
                        owner = _ownerId,
                        number = seed["number"]!.GetValue<int>(),
                        properties = seed["properties"]!.ToJsonString(),
                    });
            }
        }

        var enabled = scenario["extensionEnabled"]?.GetValue<bool>() ?? true;
        var connect = await _me.PutAsJsonAsync($"/api/extensions/{_extension}/connection", new { connected = enabled });
        connect.EnsureSuccessStatusCode();
    }
}
