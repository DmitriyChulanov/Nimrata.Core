using Dapper;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Nimrata.Core.Server;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Data;
using Nimrata.Core.Server.Modules;
using Nimrata.Core.Server.Objects;
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
builder.Services.AddOptions<SmtpOptions>().BindConfiguration(SmtpOptions.Section);
builder.Services.AddOptions<PasswordResetOptions>().BindConfiguration(PasswordResetOptions.Section);
builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();
builder.Services.AddSingleton<PasswordResetService>();
builder.Services.AddSingleton<AuthService>();
builder.Services.AddSingleton<AdminSeeder>();
builder.Services.AddSingleton<UserAdminService>();
builder.Services.AddSingleton<ChangesetService>();

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
ManifestLoader.Загрузить(connectionString, app.Configuration["Modules:Path"] ?? ManifestLoader.КаталогПоУмолчанию);
app.Services.GetRequiredService<AdminSeeder>().Выполнить().GetAwaiter().GetResult();

app.UseDefaultFiles();
// Собранный клиент лежит в wwwroot (кладётся при публикации); раздаём его с диска, без манифеста статических ресурсов.
// UseRouting вызывается явно после статики: иначе fallback-маршрут выбирается раньше и перекрывает файлы.
app.UseStaticFiles();
app.UseRouting();

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

// Неизвестные маршруты отдают клиентское приложение (клиентская маршрутизация), кроме /api: там остаётся 404.
app.MapFallbackToFile("{*path:regex(^(?!api(/|$)).*$)}", "index.html").AllowAnonymous();

app.Run();

public partial class Program;
