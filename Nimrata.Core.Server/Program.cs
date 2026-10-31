using Dapper;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Nimrata.Core.Server;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Data;
using Nimrata.Core.Server.Extensions;
using Nimrata.Core.Server.Objects;
using Nimrata.Core.Server.Sync;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddProblemDetails();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddOpenApi();

SqlMapper.AddTypeHandler(new JsonbTypeHandler());

// Настройки читаются лениво (уже после сборки хоста), чтобы работали и переопределения тестового стенда
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
builder.Services.AddSingleton<ObjectsService>();
builder.Services.AddSingleton<JournalService>();
builder.Services.AddSingleton<TypesService>();
builder.Services.AddSingleton<ExtensionsService>();
builder.Services.AddOptions<SyncOptions>().BindConfiguration(SyncOptions.Section).ValidateDataAnnotations().ValidateOnStart();
builder.Services.AddSingleton<SyncService>();
builder.Services.AddSingleton<ChangeDispatcher>();
builder.Services.AddSingleton<IChangeNotifier>(sp => sp.GetRequiredService<ChangeDispatcher>());
builder.Services.AddSignalR();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<IOptions<JwtOptions>>((o, jwt) =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Value.Issuer,
            ValidAudience = jwt.Value.Audience,
            IssuerSigningKey = jwt.Value.CreateSigningKey(),
            RoleClaimType = System.Security.Claims.ClaimTypes.Role,
            NameClaimType = "sub",
            ClockSkew = TimeSpan.FromSeconds(30),
        };
        // Браузер не передаёт заголовок Authorization в WebSocket: для хаба синхронизации (и только для него)
        // токен берётся из query access_token
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                if (context.HttpContext.Request.Path.StartsWithSegments(SyncHub.Path)
                    && context.Request.Query["access_token"] is { Count: > 0 } token)
                {
                    context.Token = token;
                }
                return Task.CompletedTask;
            },
        };
    });
// Всё API закрыто по умолчанию; открытые маршруты помечаются AllowAnonymous
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

var app = builder.Build();

var connectionString = app.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException(
        "Не задана строка подключения ConnectionStrings:Default (appsettings или переменная ConnectionStrings__Default).");

Startup.ApplyMigrations(connectionString);
ManifestLoader.Load(connectionString, app.Configuration["Extensions:Path"] ?? ManifestLoader.DefaultDirectory);
await app.Services.GetRequiredService<AdminSeeder>().SeedAsync();

app.UseDefaultFiles();
// Собранный клиент лежит в wwwroot (кладётся при публикации); раздаём его с диска, без манифеста статических ресурсов.
// UseRouting вызывается явно после статики: иначе fallback-маршрут выбирается раньше и перекрывает файлы
// Заголовки кэширования: service worker и оболочка проверяются у сервера каждый раз, ассеты с хэшем — надолго
var clientFiles = ClientCaching.CreateStaticFileOptions();
app.UseStaticFiles(clientFiles);
app.UseRouting();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
}

app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<SyncHub>(SyncHub.Path);

app.MapGet("/health", async (CancellationToken cancellationToken) =>
{
    await using var connection = new NpgsqlConnection(connectionString);
    await connection.ExecuteScalarAsync<int>(new CommandDefinition("select 1", cancellationToken: cancellationToken));
    return Results.Ok(new { status = "ok" });
}).AllowAnonymous();

// Неизвестные маршруты отдают клиентское приложение (клиентская маршрутизация), кроме /api: там остаётся 404
app.MapFallbackToFile("{*path:regex(^(?!api(/|$)).*$)}", "index.html", clientFiles).AllowAnonymous();

app.Run();

/// <summary>
/// Точка входа сервера; открыта для тестового стенда <c>WebApplicationFactory&lt;Program&gt;</c>
/// </summary>
public partial class Program;
