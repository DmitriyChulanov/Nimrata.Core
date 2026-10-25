using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nimrata.Core.Server.Auth;

namespace Nimrata.Core.Server.Controllers;

public sealed record CreateUserRequest(string? Email, string? Name, string? Password, string? Role);

public sealed record ChangeRoleRequest(string? Role);

/// <summary>Управление пользователями; только роль «Администратор».</summary>
[ApiController]
[Authorize(Roles = UserAdminService.RoleAdmin)]
[Route("api/admin/users")]
public sealed class AdminUsersController(UserAdminService пользователи, PasswordResetService сброс) : ControllerBase
{
    /// <summary>Отправляет пользователю то же письмо со ссылкой на смену пароля, что и «Забыли пароль?».</summary>
    [HttpPost("{id:guid}/password-reset")]
    public async Task<IActionResult> SendPasswordReset(Guid id) =>
        await сброс.ОтправитьПользователю(id) == ResetStatus.Ok
            ? NoContent()
            : NotFound(new { error = "Пользователь не найден или отключён." });

    [HttpGet]
    public async Task<IActionResult> List() => Ok(await пользователи.Список());

    [HttpPost]
    public async Task<IActionResult> Create(CreateUserRequest запрос)
    {
        var результат = await пользователи.Создать(запрос.Email, запрос.Name, запрос.Password, запрос.Role);
        return результат.Status == UserOpStatus.Ok
            ? Created($"/api/admin/users/{результат.User!.Id}", результат.User)
            : Ответ(результат);
    }

    [HttpPut("{id:guid}/role")]
    public async Task<IActionResult> ChangeRole(Guid id, ChangeRoleRequest запрос) =>
        Ответ(await пользователи.СменитьРоль(id, запрос.Role));

    [HttpPost("{id:guid}/disable")]
    public async Task<IActionResult> Disable(Guid id) => Ответ(await пользователи.Отключить(id));

    [HttpPost("{id:guid}/enable")]
    public async Task<IActionResult> Enable(Guid id) => Ответ(await пользователи.Включить(id));

    private IActionResult Ответ(UserOpResult результат) => результат.Status switch
    {
        UserOpStatus.Ok => NoContent(),
        UserOpStatus.NotFound => NotFound(new { error = результат.Reason }),
        UserOpStatus.Conflict => Conflict(new { error = результат.Reason }),
        _ => BadRequest(new { error = результат.Reason }),
    };
}
