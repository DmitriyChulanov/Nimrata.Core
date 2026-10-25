using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Auth;

public sealed record UserInfo(Guid Id, string Email, string Name, string Role, bool IsActive);

public enum UserOpStatus { Ok, NotFound, Invalid, Conflict }

public sealed record UserOpResult(UserOpStatus Status, string? Reason = null, UserInfo? User = null);

/// <summary>Администрирование пользователей: создание, смена роли, отключение и включение (удаления нет).</summary>
public sealed class UserAdminService(NpgsqlDataSource данные)
{
    public const string RoleAdmin = "admin";
    public const string RoleMember = "member";

    private const string ПоследнийАдминистратор =
        "Нельзя отключить или понизить последнего действующего администратора: сначала назначьте другого.";

    private sealed record Row(Guid Id, string Email, string Name, bool IsAdmin, bool IsActive)
    {
        public UserInfo ВИнфо() => new(Id, Email, Name, IsAdmin ? RoleAdmin : RoleMember, IsActive);
    }

    private const string Колонки = "id, email, display_name as Name, is_admin as IsAdmin, is_active as IsActive";

    public async Task<IReadOnlyList<UserInfo>> Список()
    {
        await using var соединение = await данные.OpenConnectionAsync();
        var строки = await соединение.QueryAsync<Row>($"select {Колонки} from users order by lower(email)");
        return строки.Select(r => r.ВИнфо()).ToList();
    }

    public async Task<UserOpResult> Создать(string? email, string? имя, string? пароль, string? роль)
    {
        email = email?.Trim();
        if (string.IsNullOrEmpty(email) || !email.Contains('@'))
            return new(UserOpStatus.Invalid, "Укажите корректный e-mail.");
        if (string.IsNullOrEmpty(пароль) || пароль.Length < AuthService.MinPasswordLength)
            return new(UserOpStatus.Invalid, $"Пароль должен быть не короче {AuthService.MinPasswordLength} символов.");
        if (роль is not (RoleAdmin or RoleMember))
            return new(UserOpStatus.Invalid, "Роль должна быть «admin» или «member».");

        await using var соединение = await данные.OpenConnectionAsync();
        var строка = await соединение.QuerySingleOrDefaultAsync<Row>(
            $"""
            insert into users (email, display_name, password_hash, is_admin)
            values (@email, @имя, @хеш, @админ)
            on conflict (lower(email)) do nothing
            returning {Колонки}
            """,
            new { email, имя = имя?.Trim() ?? "", хеш = AuthService.ХешПароля(пароль), админ = роль == RoleAdmin });
        return строка is null
            ? new(UserOpStatus.Conflict, "Пользователь с таким e-mail уже существует.")
            : new(UserOpStatus.Ok, null, строка.ВИнфо());
    }

    public Task<UserOpResult> СменитьРоль(Guid id, string? роль)
    {
        if (роль is not (RoleAdmin or RoleMember))
            return Task.FromResult(new UserOpResult(UserOpStatus.Invalid, "Роль должна быть «admin» или «member»."));
        return Изменить(id, понижение: роль == RoleMember,
            "update users set is_admin = @админ where id = @id", new { id, админ = роль == RoleAdmin });
    }

    public Task<UserOpResult> Отключить(Guid id) =>
        Изменить(id, понижение: true,
            """
            with u as (update users set is_active = false where id = @id returning id)
            update refresh_tokens set revoked_at = now()
            where user_id in (select id from u) and revoked_at is null
            """,
            new { id }, отключение: true);

    public Task<UserOpResult> Включить(Guid id) =>
        Изменить(id, понижение: false, "update users set is_active = true where id = @id", new { id });

    /// <summary>
    /// Применяет изменение в транзакции; перед проверкой «последнего администратора» блокирует строки администраторов,
    /// чтобы два параллельных запроса не оставили систему без администратора.
    /// </summary>
    private async Task<UserOpResult> Изменить(Guid id, bool понижение, string sql, object параметры, bool отключение = false)
    {
        await using var соединение = await данные.OpenConnectionAsync();
        await using var транзакция = await соединение.BeginTransactionAsync();

        var админы = (await соединение.QueryAsync<Guid>(
            "select id from users where is_admin and is_active for update", transaction: транзакция)).ToList();
        var цель = await соединение.QuerySingleOrDefaultAsync<Row>(
            $"select {Колонки} from users where id = @id for update", new { id }, транзакция);
        if (цель is null) return new(UserOpStatus.NotFound, "Пользователь не найден.");

        if (понижение && цель.IsAdmin && цель.IsActive && админы.Count <= 1)
            return new(UserOpStatus.Conflict, ПоследнийАдминистратор);

        await соединение.ExecuteAsync(sql, параметры, транзакция);
        await транзакция.CommitAsync();
        return new(UserOpStatus.Ok);
    }
}
