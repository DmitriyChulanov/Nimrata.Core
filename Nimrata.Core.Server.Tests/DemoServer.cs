using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Controllers.Responses;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Сервер на отдельной БД с расширением <c>demo</c> (папки и элементы) и двумя вошедшими пользователями
/// </summary>
/// <param name="factory">Общий стенд с контейнером Postgres</param>
/// <param name="settings">Дополнительные настройки сервера (например, секция <c>Sync</c>)</param>
public sealed class DemoServer(ServerFactory factory, IReadOnlyDictionary<string, string?>? settings = null) : IAsyncDisposable
{
    private const string Manifest = """
        {
          "extension": "demo", "version": 1, "name": "Демо", "description": "Тестовое расширение", "icon": "star", "defaultEnabled": true,
          "types": [
            { "id": "Folder", "name": "Папка", "allowedChildren": ["Item", "Folder"] },
            { "id": "Item", "name": "Элемент", "allowedChildren": [],
              "properties": [ { "id": "title", "name": "Заголовок", "kind": "string" } ] }
          ]
        }
        """;

    /// <summary>
    /// Адрес второго пользователя
    /// </summary>
    public const string OtherEmail = "sync-other@example.test";

    private const string OtherPassword = "sync-other-password-1";

    private string _directory = null!;
    private WebApplicationFactory<Program> _server = null!;

    /// <summary>
    /// Строка подключения к БД этого сервера
    /// </summary>
    public string Database { get; private set; } = null!;

    /// <summary>
    /// Клиент администратора
    /// </summary>
    public HttpClient Me { get; private set; } = null!;

    /// <summary>
    /// Клиент второго пользователя
    /// </summary>
    public HttpClient Other { get; private set; } = null!;

    /// <summary>
    /// Поднимает сервер, создаёт второго пользователя и входит обоими
    /// </summary>
    /// <returns>Задача подготовки</returns>
    public async Task StartAsync()
    {
        _directory = Path.Combine(Path.GetTempPath(), "nimrata-sync-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(_directory, "demo"));
        await File.WriteAllTextAsync(Path.Combine(_directory, "demo", "manifest.json"), Manifest);
        Database = new NpgsqlConnectionStringBuilder(factory.ConnectionString)
        { Database = "s" + Guid.NewGuid().ToString("N"), Pooling = false }.ConnectionString;
        var configuration = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Default"] = Database,
            ["Extensions:Path"] = _directory,
        };
        foreach (var (key, value) in settings ?? new Dictionary<string, string?>())
        {
            configuration[key] = value;
        }
        _server = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(configuration)));
        Me = await LoginAsync(ServerFactory.AdminEmail, ServerFactory.AdminPassword);
        await _server.Services.GetRequiredService<AuthService>().CreateUserAsync(OtherEmail, OtherPassword, false);
        Other = await LoginAsync(OtherEmail, OtherPassword);
    }

    /// <summary>
    /// Клиент без токена
    /// </summary>
    /// <returns>Новый анонимный клиент</returns>
    public HttpClient CreateAnonymous() => _server.CreateClient();

    /// <summary>
    /// Освобождает клиентов, сервер и каталог манифестов
    /// </summary>
    /// <returns>Завершённая задача</returns>
    public ValueTask DisposeAsync()
    {
        Me?.Dispose();
        Other?.Dispose();
        _server?.Dispose();
        if (_directory is not null && Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
        return ValueTask.CompletedTask;
    }

    /// <summary>
    /// Описывает операцию создания объекта
    /// </summary>
    /// <param name="id">Идентификатор объекта</param>
    /// <param name="type">Тип: <c>Folder</c> или <c>Item</c></param>
    /// <param name="parent">Родитель; <c>null</c> — корень</param>
    /// <param name="title">Заголовок элемента; <c>null</c> — без свойств</param>
    /// <returns>Операция набора</returns>
    public static object Create(Guid id, string type, Guid? parent = null, string? title = null) =>
        new { op = "create", id, type, parent, number = 1, properties = title is null ? new { } : (object)new { title } };

    /// <summary>
    /// Входит пользователем и возвращает клиента с токеном
    /// </summary>
    /// <param name="email">Адрес пользователя</param>
    /// <param name="password">Пароль пользователя</param>
    /// <returns>Клиент с access-токеном</returns>
    private async Task<HttpClient> LoginAsync(string email, string password)
    {
        var client = _server.CreateClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password });
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.AccessToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
