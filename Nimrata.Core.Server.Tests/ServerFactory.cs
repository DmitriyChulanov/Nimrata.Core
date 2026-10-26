using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Hosting;
using Npgsql;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Nimrata.Core.Server.Auth;
using Testcontainers.PostgreSql;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Тестовый стенд: сервер в памяти + настоящий Postgres в Testcontainers
/// </summary>
public class ServerFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine").Build();

    /// <summary>
    /// Адрес администратора, создаваемого при старте стенда
    /// </summary>
    public const string AdminEmail = "admin@example.test";
    /// <summary>
    /// Пароль администратора, создаваемого при старте стенда
    /// </summary>
    public const string AdminPassword = "test-admin-password";

    /// <summary>
    /// Строка подключения к Postgres в контейнере
    /// </summary>
    public string ConnectionString => _postgres.GetConnectionString();

    async Task IAsyncLifetime.InitializeAsync() => await _postgres.StartAsync();

    async Task IAsyncLifetime.DisposeAsync()
    {
        await _postgres.DisposeAsync();
    }

    /// <summary>
    /// Поддельная почта: письма не уходят по сети, а копятся здесь
    /// </summary>
    public FakeEmailSender Mailbox { get; } = new();

    /// <summary>
    /// Подставляет настройки стенда и поддельную почту
    /// </summary>
    /// <param name="builder">Построитель веб-хоста</param>
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = ConnectionString,
                ["Jwt:Key"] = "тестовый-ключ-подписи-не-для-продакшена-0123456789",
                ["Admin:Email"] = AdminEmail,
                ["Admin:Password"] = AdminPassword,
                ["PasswordReset:PublicUrl"] = "https://nimrata.test",
            }));
        builder.ConfigureTestServices(services => services.AddSingleton<IEmailSender>(Mailbox));
    }
}
