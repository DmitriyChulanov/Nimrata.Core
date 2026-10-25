using Dapper;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Nimrata.Core.Server.Auth;

public enum ResetStatus { Ok, NotFound, Invalid }

/// <summary>Выдача одноразовых ссылок сброса пароля и установка нового пароля по ним.</summary>
public sealed class PasswordResetService(
    NpgsqlDataSource данные,
    IEmailSender почта,
    IOptions<PasswordResetOptions> настройки,
    ILogger<PasswordResetService> лог)
{
    private sealed record Target(Guid Id, string Email);

    /// <summary>Письмо уходит только существующему действующему пользователю; вызывающий отвечает одинаково в любом случае.</summary>
    public async Task ЗапроситьПоEmail(string email)
    {
        await using var соединение = await данные.OpenConnectionAsync();
        var цель = await соединение.QuerySingleOrDefaultAsync<Target>(
            "select id, email from users where lower(email) = lower(@email) and is_active", new { email });
        if (цель is not null) await Отправить(соединение, цель);
    }

    public async Task<ResetStatus> ОтправитьПользователю(Guid id)
    {
        await using var соединение = await данные.OpenConnectionAsync();
        var цель = await соединение.QuerySingleOrDefaultAsync<Target>(
            "select id, email from users where id = @id and is_active", new { id });
        if (цель is null) return ResetStatus.NotFound;
        await Отправить(соединение, цель);
        return ResetStatus.Ok;
    }

    private async Task Отправить(NpgsqlConnection соединение, Target цель)
    {
        var o = настройки.Value;
        var срок = TimeSpan.FromMinutes(o.LifetimeMinutes);
        var токен = ResetTokens.Создать();
        await соединение.ExecuteAsync(
            """
            update password_reset_tokens set used_at = now() where user_id = @userId and used_at is null;
            insert into password_reset_tokens (user_id, token_hash, expires_at) values (@userId, @хеш, @истекает)
            """,
            new { userId = цель.Id, хеш = токен.Хеш, истекает = DateTimeOffset.UtcNow.Add(срок) });

        try
        {
            await почта.Отправить(PasswordResetMail.Составить(
                цель.Email, PasswordResetMail.Ссылка(o.PublicUrl, токен.Токен), срок));
        }
        catch (Exception ошибка)
        {
            // сбой почты не должен менять ответ и раскрывать существование пользователя
            лог.LogError(ошибка, "Не удалось отправить письмо сброса пароля.");
        }
    }

    /// <summary>Атомарно «сжигает» ссылку, меняет пароль и отзывает все refresh-токены пользователя.</summary>
    public async Task<ResetStatus> УстановитьПароль(string? токен, string? пароль)
    {
        if (string.IsNullOrEmpty(токен) || string.IsNullOrEmpty(пароль) || пароль.Length < AuthService.MinPasswordLength)
            return ResetStatus.Invalid;

        await using var соединение = await данные.OpenConnectionAsync();
        await using var транзакция = await соединение.BeginTransactionAsync();

        var userId = await соединение.QuerySingleOrDefaultAsync<Guid?>(
            """
            update password_reset_tokens t set used_at = now()
            from users u
            where t.token_hash = @хеш and t.used_at is null and t.expires_at > now()
              and u.id = t.user_id and u.is_active
            returning t.user_id
            """,
            new { хеш = ResetTokens.Хеш(токен) }, транзакция);
        if (userId is null)
        {
            await транзакция.RollbackAsync();
            return ResetStatus.Invalid;
        }

        await соединение.ExecuteAsync(
            """
            update users set password_hash = @хеш where id = @id;
            update refresh_tokens set revoked_at = now() where user_id = @id and revoked_at is null;
            update password_reset_tokens set used_at = now() where user_id = @id and used_at is null
            """,
            new { id = userId, хеш = AuthService.ХешПароля(пароль) }, транзакция);
        await транзакция.CommitAsync();
        return ResetStatus.Ok;
    }
}
