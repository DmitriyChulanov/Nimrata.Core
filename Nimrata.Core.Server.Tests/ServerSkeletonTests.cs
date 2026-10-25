using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Hosting;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Nimrata.Core.Server.Tests;

/// <summary>Тестовый стенд: сервер в памяти + настоящий Postgres в Testcontainers.</summary>
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

    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.ConfigureAppConfiguration((_, конфигурация) =>
            конфигурация.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = ConnectionString,
                ["Jwt:Key"] = "тестовый-ключ-подписи-не-для-продакшена-0123456789",
                ["Admin:Email"] = AdminEmail,
                ["Admin:Password"] = AdminPassword,
            }));
}

public class ServerSkeletonTests(ServerFactory фабрика) : IClassFixture<ServerFactory>
{
    [Fact]
    public async Task Health_ПослеСтартаОтвечаетОкИМиграцииПрименены()
    {
        using var клиент = фабрика.CreateClient();

        var ответ = await клиент.GetAsync("/health");

        Assert.True(ответ.IsSuccessStatusCode);
        await using var соединение = new NpgsqlConnection(фабрика.ConnectionString);
        var скрипты = await соединение.QueryAsync<string>("select scriptname from schemaversions order by scriptname");
        Assert.Contains(скрипты, s => s.EndsWith("0001_schema_info.sql"));
    }
}







