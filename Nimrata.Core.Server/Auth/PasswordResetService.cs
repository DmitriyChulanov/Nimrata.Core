using Dapper;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Выдача одноразовых ссылок сброса пароля и установка нового пароля по ним
/// </summary>
public sealed class PasswordResetService(
    NpgsqlDataSource dataSource,
    IEmailSender emailSender,
    IOptions<PasswordResetOptions> options,
    TimeProvider timeProvider,
    ILogger<PasswordResetService> logger)
{
    private sealed record Target(Guid Id, string Email);

    /// <summary>
    /// Письмо уходит только существующему действующему пользователю; вызывающий отвечает одинаково в любом случае
    /// </summary>
    public async Task RequestByEmailAsync(string email, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var target = await connection.QuerySingleOrDefaultAsync<Target>(new CommandDefinition(
            "select id, email from users where lower(email) = lower(@email) and is_active",
            new { email },
            cancellationToken: cancellationToken));
        if (target is not null)
        {
            await SendAsync(connection, target, cancellationToken);
        }
    }

    /// <summary>
    /// Отправляет ссылку сброса действующему пользователю по идентификатору
    /// </summary>
    public async Task<ResetStatus> SendToUserAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var target = await connection.QuerySingleOrDefaultAsync<Target>(new CommandDefinition(
            "select id, email from users where id = @id and is_active",
            new { id },
            cancellationToken: cancellationToken));
        if (target is null)
        {
            return ResetStatus.NotFound;
        }
        await SendAsync(connection, target, cancellationToken);
        return ResetStatus.Ok;
    }

    /// <summary>
    /// Атомарно «сжигает» ссылку, меняет пароль и отзывает все refresh-токены пользователя
    /// </summary>
    public async Task<ResetStatus> SetPasswordAsync(
        string? token, string? password, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(token) || !Passwords.IsAcceptable(password))
        {
            return ResetStatus.Invalid;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var userId = await connection.QuerySingleOrDefaultAsync<Guid?>(new CommandDefinition(
            """
            update password_reset_tokens t set used_at = now()
            from users u
            where t.token_hash = @tokenHash and t.used_at is null and t.expires_at > now()
              and u.id = t.user_id and u.is_active
            returning t.user_id
            """,
            new { tokenHash = OpaqueTokens.Hash(token) },
            transaction,
            cancellationToken: cancellationToken));
        if (userId is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return ResetStatus.Invalid;
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            update users set password_hash = @passwordHash where id = @id;
            update refresh_tokens set revoked_at = now() where user_id = @id and revoked_at is null;
            update password_reset_tokens set used_at = now() where user_id = @id and used_at is null
            """,
            new { id = userId, passwordHash = Passwords.Hash(password) },
            transaction,
            cancellationToken: cancellationToken));
        await transaction.CommitAsync(cancellationToken);
        return ResetStatus.Ok;
    }

    private async Task SendAsync(NpgsqlConnection connection, Target target, CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var lifetime = TimeSpan.FromMinutes(settings.LifetimeMinutes);
        var token = OpaqueTokens.Create();
        await connection.ExecuteAsync(new CommandDefinition(
            """
            update password_reset_tokens set used_at = now() where user_id = @userId and used_at is null;
            insert into password_reset_tokens (user_id, token_hash, expires_at) values (@userId, @tokenHash, @expiresAt)
            """,
            new { userId = target.Id, tokenHash = token.Hash, expiresAt = timeProvider.GetUtcNow().Add(lifetime) },
            cancellationToken: cancellationToken));

        try
        {
            var link = PasswordResetMail.BuildLink(settings.PublicUrl, token.Value);
            await emailSender.SendAsync(PasswordResetMail.Compose(target.Email, link, lifetime), cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // сбой почты не должен менять ответ и раскрывать существование пользователя
            logger.LogError(exception, "Не удалось отправить письмо сброса пароля.");
        }
    }
}
