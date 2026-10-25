using Dapper;
using Nimrata.Core.Server;
using Nimrata.Core.Server.Data;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();

SqlMapper.AddTypeHandler(new JsonbTypeHandler());

var app = builder.Build();

var connectionString = app.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException(
        "Не задана строка подключения ConnectionStrings:Default (appsettings или переменная ConnectionStrings__Default).");

Startup.ApplyMigrations(connectionString);

app.UseDefaultFiles();
app.MapStaticAssets();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();

app.MapGet("/health", async () =>
{
    await using var соединение = new NpgsqlConnection(connectionString);
    await соединение.ExecuteScalarAsync<int>("select 1");
    return Results.Ok(new { status = "ok" });
});

app.MapFallbackToFile("/index.html");

app.Run();

public partial class Program;
