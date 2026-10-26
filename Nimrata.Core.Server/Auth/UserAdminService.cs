using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Администрирование пользователей: создание, смена роли, отключение и включение (удаления нет)
/// </summary>
public sealed class UserAdminService(NpgsqlDataSource dataSource)
{
    private const string LastAdminReason =
        "Нельзя отключить или понизить последнего действующего администратора: сначала назначьте другого.";

    private const string InvalidRoleReason = "Роль должна быть «admin» или «member».";

    private const string Columns = "id, email, display_name as Name, is_admin as IsAdmin, is_active as IsActive";

    private sealed record Row(Guid Id, string Email, string Name, bool IsAdmin, bool IsActive)
    {
        public UserInfo ToInfo() => new(Id, Email, Name, IsAdmin ? Roles.Admin : Roles.Member, IsActive);
    }

    /// <summary>
    /// Все пользователи по алфавиту e-mail
    /// </summary>
    public async Task<IReadOnlyList<UserInfo>> ListAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"select {Columns} from users order by lower(email)", cancellationToken: cancellationToken));
        return rows.Select(row => row.ToInfo()).ToList();
    }

    /// <summary>
    /// Создаёт пользователя; при невалидных данных или занятом e-mail возвращает причину отказа
    /// </summary>
    public async Task<UserOpResult> CreateAsync(
        string? email, string? name, string? password, string? role, CancellationToken cancellationToken = default)
    {
        email = email?.Trim();
        if (string.IsNullOrEmpty(email) || !email.Contains('@'))
        {
            return new(UserOpStatus.Invalid, "Укажите корректный e-mail.");
        }
        if (!Passwords.IsAcceptable(password))
        {
            return new(UserOpStatus.Invalid, $"Пароль должен быть не короче {Passwords.MinLength} символов.");
        }
        if (!Roles.IsKnown(role))
        {
            return new(UserOpStatus.Invalid, InvalidRoleReason);
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            $"""
            insert into users (email, display_name, password_hash, is_admin)
            values (@email, @name, @passwordHash, @isAdmin)
            on conflict (lower(email)) do nothing
            returning {Columns}
            """,
            new
            {
                email,
                name = name?.Trim() ?? "",
                passwordHash = Passwords.Hash(password),
                isAdmin = role == Roles.Admin,
            },
            cancellationToken: cancellationToken));
        return row is null
            ? new(UserOpStatus.Conflict, "Пользователь с таким e-mail уже существует.")
            : new(UserOpStatus.Ok, null, row.ToInfo());
    }

    /// <summary>
    /// Назначает пользователю роль
    /// </summary>
    public Task<UserOpResult> ChangeRoleAsync(Guid id, string? role, CancellationToken cancellationToken = default)
    {
        if (!Roles.IsKnown(role))
        {
            return Task.FromResult(new UserOpResult(UserOpStatus.Invalid, InvalidRoleReason));
        }
        return ApplyAsync(
            id,
            reducesAdmins: role == Roles.Member,
            "update users set is_admin = @isAdmin where id = @id",
            new { id, isAdmin = role == Roles.Admin },
            cancellationToken);
    }

    /// <summary>
    /// Отключает пользователя и отзывает его refresh-токены
    /// </summary>
    public Task<UserOpResult> DisableAsync(Guid id, CancellationToken cancellationToken = default) =>
        ApplyAsync(
            id,
            reducesAdmins: true,
            """
            with u as (update users set is_active = false where id = @id returning id)
            update refresh_tokens set revoked_at = now()
            where user_id in (select id from u) and revoked_at is null
            """,
            new { id },
            cancellationToken);

    /// <summary>
    /// Снова включает отключённого пользователя
    /// </summary>
    public Task<UserOpResult> EnableAsync(Guid id, CancellationToken cancellationToken = default) =>
        ApplyAsync(
            id,
            reducesAdmins: false,
            "update users set is_active = true where id = @id",
            new { id },
            cancellationToken);

    /// <summary>
    /// Применяет изменение в транзакции; перед проверкой «последнего администратора» блокирует строки администраторов,
    /// чтобы два параллельных запроса не оставили систему без администратора
    /// </summary>
    private async Task<UserOpResult> ApplyAsync(
        Guid id, bool reducesAdmins, string sql, object parameters, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var activeAdmins = (await connection.QueryAsync<Guid>(new CommandDefinition(
            "select id from users where is_admin and is_active for update",
            transaction: transaction,
            cancellationToken: cancellationToken))).ToList();
        var target = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            $"select {Columns} from users where id = @id for update",
            new { id },
            transaction,
            cancellationToken: cancellationToken));
        if (target is null)
        {
            return new(UserOpStatus.NotFound, "Пользователь не найден.");
        }

        if (reducesAdmins && target is { IsAdmin: true, IsActive: true } && activeAdmins.Count <= 1)
        {
            return new(UserOpStatus.Conflict, LastAdminReason);
        }

        await connection.ExecuteAsync(new CommandDefinition(
            sql, parameters, transaction, cancellationToken: cancellationToken));
        await transaction.CommitAsync(cancellationToken);
        return new(UserOpStatus.Ok);
    }
}
