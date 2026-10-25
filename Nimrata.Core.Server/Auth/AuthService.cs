using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Npgsql;

namespace Nimrata.Core.Server.Auth;

public sealed record AuthResult(string AccessToken, string RefreshToken, DateTimeOffset RefreshExpiresAt);

/// <summary>Вход, обновление и отзыв токенов, создание пользователей.</summary>
public sealed class AuthService(NpgsqlDataSource данные, IOptions<JwtOptions> настройки)
{
    public const int MinPasswordLength = 8;

    private static readonly PasswordHasher<object> Хешер = new();

    private sealed record UserRow(Guid Id, string Email, string PasswordHash, bool IsAdmin, bool IsActive);

    public static SymmetricSecurityKey КлючПодписи(JwtOptions o)
    {
        var байты = Encoding.UTF8.GetBytes(o.Key ?? "");
        if (байты.Length < 32)
        {
            throw new InvalidOperationException(
                "Не задан ключ подписи JWT (Jwt:Key, не короче 32 байт): user-secrets или переменная Jwt__Key.");
        }
        return new SymmetricSecurityKey(байты);
    }

    /// <returns>true, если пользователь создан; false, если такой e-mail уже есть.</returns>
    public async Task<bool> СоздатьПользователя(string email, string пароль, bool администратор)
    {
        if (пароль.Length < MinPasswordLength)
        {
            throw new ArgumentException($"Пароль короче {MinPasswordLength} символов.");
        }

        var хеш = Хешер.HashPassword(new object(), пароль);
        await using var соединение = await данные.OpenConnectionAsync();
        var добавлено = await соединение.ExecuteAsync(
            """
            insert into users (email, password_hash, is_admin) values (@email, @хеш, @администратор)
            on conflict (lower(email)) do nothing
            """,
            new { email, хеш, администратор });
        return добавлено > 0;
    }

    public static string ХешПароля(string пароль) => Хешер.HashPassword(new object(), пароль);

    public async Task<AuthResult?> Войти(string email, string пароль)
    {
        await using var соединение = await данные.OpenConnectionAsync();
        var пользователь = await соединение.QuerySingleOrDefaultAsync<UserRow>(
            """
            select id, email, password_hash as PasswordHash, is_admin as IsAdmin, is_active as IsActive
            from users where lower(email) = lower(@email)
            """,
            new { email });

        if (пользователь is null)
        {
            // выравниваем время ответа, чтобы не раскрывать существование e-mail
            Хешер.VerifyHashedPassword(new object(), Хешер.HashPassword(new object(), "x"), пароль);
            return null;
        }

        var проверка = Хешер.VerifyHashedPassword(new object(), пользователь.PasswordHash, пароль);
        if (проверка == PasswordVerificationResult.Failed || !пользователь.IsActive)
        {
            return null;
        }

        return await Выдать(соединение, пользователь, null);
    }

    /// <summary>Обменивает действующий refresh-токен на новую пару (старый отзывается).</summary>
    public async Task<AuthResult?> Обновить(string refreshToken)
    {
        var хеш = ХешТокена(refreshToken);
        await using var соединение = await данные.OpenConnectionAsync();
        await using var транзакция = await соединение.BeginTransactionAsync();

        // условный отзыв атомарно закрывает гонку повторного использования
        var пользователь = await соединение.QuerySingleOrDefaultAsync<UserRow>(
            """
            with отозван as (
                update refresh_tokens set revoked_at = now()
                where token_hash = @хеш and revoked_at is null and expires_at > now()
                returning user_id
            )
            select u.id, u.email, u.password_hash as PasswordHash, u.is_admin as IsAdmin, u.is_active as IsActive
            from users u join отозван on отозван.user_id = u.id
            """,
            new { хеш }, транзакция);

        if (пользователь is null || !пользователь.IsActive)
        {
            await транзакция.CommitAsync();
            return null;
        }

        var результат = await Выдать(соединение, пользователь, транзакция);
        await транзакция.CommitAsync();
        return результат;
    }

    public async Task Выйти(string refreshToken)
    {
        await using var соединение = await данные.OpenConnectionAsync();
        await соединение.ExecuteAsync(
            "update refresh_tokens set revoked_at = now() where token_hash = @хеш and revoked_at is null",
            new { хеш = ХешТокена(refreshToken) });
    }

    private async Task<AuthResult> Выдать(NpgsqlConnection соединение, UserRow пользователь, NpgsqlTransaction? транзакция)
    {
        var o = настройки.Value;
        var refresh = Base64Url(RandomNumberGenerator.GetBytes(32));
        var истекает = DateTimeOffset.UtcNow.AddDays(o.RefreshDays);
        await соединение.ExecuteAsync(
            "insert into refresh_tokens (user_id, token_hash, expires_at) values (@userId, @хеш, @истекает)",
            new { userId = пользователь.Id, хеш = ХешТокена(refresh), истекает }, транзакция);

        var утверждения = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, пользователь.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, пользователь.Email),
        };
        if (пользователь.IsAdmin) утверждения.Add(new Claim(ClaimTypes.Role, "admin"));

        var токен = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(утверждения),
            Issuer = o.Issuer,
            Audience = o.Audience,
            Expires = DateTime.UtcNow.AddMinutes(o.AccessMinutes),
            SigningCredentials = new SigningCredentials(КлючПодписи(o), SecurityAlgorithms.HmacSha256),
        });
        return new AuthResult(токен, refresh, истекает);
    }

    private static string ХешТокена(string токен) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(токен)));

    private static string Base64Url(byte[] байты) =>
        Convert.ToBase64String(байты).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
