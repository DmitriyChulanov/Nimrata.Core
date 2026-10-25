using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Tests;

public class ServerSkeletonTests(ServerFactory factory) : IClassFixture<ServerFactory>
{
    [Fact]
    public async Task Health_AfterStart_ReturnsOkAndMigrationsApplied()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.True(response.IsSuccessStatusCode);
        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        var scripts = await connection.QueryAsync<string>("select scriptname from schemaversions order by scriptname");
        Assert.Contains(scripts, s => s.EndsWith("0001_schema_info.sql"));
    }
}







