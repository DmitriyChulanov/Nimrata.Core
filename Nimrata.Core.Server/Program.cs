using Dapper;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Nimrata.Core.Server;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Data;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();

SqlMapper.AddTypeHandler(new JsonbTypeHandler());

// Настройки читаются лениво (уже после сборки хоста), чтобы работали и переопределения тестового стенда.
builder.Services.AddOptions<JwtOptions>().BindConfiguration(JwtOptions.Section);
builder.Services.AddOptions<AdminSeedOptions>().BindConfiguration(AdminSeedOptions.Section);
builder.Services.AddSingleton(sp => NpgsqlDataSource.Create(
    sp.GetRequiredService<IConfiguration>().GetConnectionString("Default")
    ?? throw new InvalidOperationException("Не задана строка подключения ConnectionStrings:Default.")));
builder.Services.AddSingleton<AuthService>();
builder.Services.AddSingleton<AdminSeeder>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<IOptions<JwtOptions>>((o, jwt) =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Value.Issuer,
            ValidAudience = jwt.Value.Audience,
            IssuerSigningKey = AuthService.КлючПодписи(jwt.Value),
            RoleClaimType = System.Security.Claims.ClaimTypes.Role,
            NameClaimType = "sub",
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });
// Всё API закрыто по умолчанию; открытые маршруты помечаются AllowAnonymous.
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

var app = builder.Build();

var connectionString = app.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException(
        "Не задана строка подключения ConnectionStrings:Default (appsettings или переменная ConnectionStrings__Default).");

Startup.ApplyMigrations(connectionString);
app.Services.GetRequiredService<AdminSeeder>().Выполнить().GetAwaiter().GetResult();

app.UseDefaultFiles();
app.MapStaticAssets().AllowAnonymous();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
}

app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.MapGet("/health", async () =>
{
    await using var соединение = new NpgsqlConnection(connectionString);
    await соединение.ExecuteScalarAsync<int>("select 1");
    return Results.Ok(new { status = "ok" });
}).AllowAnonymous();

app.MapFallbackToFile("/index.html").AllowAnonymous();

app.Run();

public partial class Program;
