using System.Security.Claims;
using Dapper;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Npgsql;

namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Вход, обновление и отзыв токенов, создание пользователей
/// </summary>
public sealed class AuthService(NpgsqlDataSource dataSource, IOptions<JwtOptions> options, TimeProvider timeProvider)
{
    private sealed record UserRow(Guid Id, string Email, string PasswordHash, bool IsAdmin, bool IsActive);

    /// <summary>
    /// Создаёт пользователя
    /// </summary>
    /// <returns><c>true</c>, если пользователь создан; <c>false</c>, если такой e-mail уже есть</returns>
    /// <exception cref="ArgumentException">Пароль короче <see cref="Passwords.MinLength"/> символов</exception>
    public async Task<bool> CreateUserAsync(
        string email, string password, bool isAdmin, CancellationToken cancellationToken = default)
    {
        if (!Passwords.IsAcceptable(password))
        {
            throw new ArgumentException($"Пароль короче {Passwords.MinLength} символов.", nameof(password));
        }

        var passwordHash = Passwords.Hash(password);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var inserted = await connection.ExecuteAsync(new CommandDefinition(
            """
            insert into users (email, password_hash, is_admin) values (@email, @passwordHash, @isAdmin)
            on conflict (lower(email)) do nothing
            """,
            new { email, passwordHash, isAdmin },
            cancellationToken: cancellationToken));
        return inserted > 0;
    }

    /// <summary>
    /// Проверяет учётные данные и выдаёт токены; <c>null</c>, если вход не удался
    /// </summary>
    public async Task<AuthResult?> LoginAsync(string email, string password, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var user = await connection.QuerySingleOrDefaultAsync<UserRow>(new CommandDefinition(
            """
            select id, email, password_hash as PasswordHash, is_admin as IsAdmin, is_active as IsActive
            from users where lower(email) = lower(@email)
            """,
            new { email },
            cancellationToken: cancellationToken));

        if (user is null)
        {
            // выравниваем время ответа, чтобы не раскрывать существование e-mail
            Passwords.Verify(Passwords.Hash("x"), password);
            return null;
        }

        if (!Passwords.Verify(user.PasswordHash, password) || !user.IsActive)
        {
            return null;
        }

        return await IssueAsync(connection, user, null, cancellationToken);
    }

    /// <summary>
    /// Обменивает действующий refresh-токен на новую пару (старый отзывается)
    /// </summary>
    /// <returns>Новая пара токенов или <c>null</c>, если токен недействителен</returns>
    public async Task<AuthResult?> RefreshAsync(string refreshToken, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        // условный отзыв атомарно закрывает гонку повторного использования
        var user = await connection.QuerySingleOrDefaultAsync<UserRow>(new CommandDefinition(
            """
            with revoked as (
                update refresh_tokens set revoked_at = now()
                where token_hash = @tokenHash and revoked_at is null and expires_at > now()
                returning user_id
            )
            select u.id, u.email, u.password_hash as PasswordHash, u.is_admin as IsAdmin, u.is_active as IsActive
            from users u join revoked on revoked.user_id = u.id
            """,
            new { tokenHash = OpaqueTokens.Hash(refreshToken) },
            transaction,
            cancellationToken: cancellationToken));

        if (user is not { IsActive: true })
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        var result = await IssueAsync(connection, user, transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return result;
    }

    /// <summary>
    /// Отзывает refresh-токен
    /// </summary>
    public async Task LogoutAsync(string refreshToken, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            "update refresh_tokens set revoked_at = now() where token_hash = @tokenHash and revoked_at is null",
            new { tokenHash = OpaqueTokens.Hash(refreshToken) },
            cancellationToken: cancellationToken));
    }

    private async Task<AuthResult> IssueAsync(
        NpgsqlConnection connection, UserRow user, NpgsqlTransaction? transaction, CancellationToken cancellationToken)
    {
        var jwt = options.Value;
        var now = timeProvider.GetUtcNow();
        var refresh = OpaqueTokens.Create();
        var refreshExpiresAt = now.AddDays(jwt.RefreshDays);
        await connection.ExecuteAsync(new CommandDefinition(
            "insert into refresh_tokens (user_id, token_hash, expires_at) values (@userId, @tokenHash, @expiresAt)",
            new { userId = user.Id, tokenHash = refresh.Hash, expiresAt = refreshExpiresAt },
            transaction,
            cancellationToken: cancellationToken));

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
        };
        if (user.IsAdmin)
        {
            claims.Add(new Claim(ClaimTypes.Role, Roles.Admin));
        }

        var accessToken = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Issuer = jwt.Issuer,
            Audience = jwt.Audience,
            Expires = now.AddMinutes(jwt.AccessMinutes).UtcDateTime,
            SigningCredentials = new SigningCredentials(jwt.CreateSigningKey(), SecurityAlgorithms.HmacSha256),
        });
        return new AuthResult(accessToken, refresh.Value, refreshExpiresAt);
    }
}
