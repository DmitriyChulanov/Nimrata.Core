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

/// <summary>Тестовый стенд: сервер в памяти + настоящий Postgres в Testcontainers</summary>
public class ServerFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine").Build();

    public const string AdminEmail = "admin@example.test";
    public const string AdminPassword = "test-admin-password";

    public string ConnectionString => _postgres.GetConnectionString();

    async Task IAsyncLifetime.InitializeAsync() => await _postgres.StartAsync();

    async Task IAsyncLifetime.DisposeAsync()
    {
        await _postgres.DisposeAsync();
    }

    /// <summary>Поддельная почта: письма не уходят по сети, а копятся здесь</summary>
    public FakeEmailSender Mailbox { get; } = new();

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
