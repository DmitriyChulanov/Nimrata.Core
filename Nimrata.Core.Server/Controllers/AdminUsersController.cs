using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Controllers.Requests;

namespace Nimrata.Core.Server.Controllers;

/// <summary>Управление пользователями; только роль «Администратор»</summary>
[ApiController]
[Authorize(Roles = Roles.Admin)]
[Route("api/admin/users")]
public sealed class AdminUsersController(UserAdminService userAdminService, PasswordResetService passwordResetService)
    : ControllerBase
{
    /// <summary>Отправляет пользователю то же письмо со ссылкой на смену пароля, что и «Забыли пароль?»</summary>
    [HttpPost("{id:guid}/password-reset")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> SendPasswordReset(Guid id, CancellationToken cancellationToken) =>
        await passwordResetService.SendToUserAsync(id, cancellationToken) == ResetStatus.Ok
            ? NoContent()
            : Problem(detail: "Пользователь не найден или отключён.", statusCode: StatusCodes.Status404NotFound);

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<UserInfo>>> List(CancellationToken cancellationToken) =>
        Ok(await userAdminService.ListAsync(cancellationToken));

    [HttpPost]
    [ProducesResponseType<UserInfo>(StatusCodes.Status201Created)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<UserInfo>> Create(CreateUserRequest request, CancellationToken cancellationToken)
    {
        var result = await userAdminService.CreateAsync(
            request.Email, request.Name, request.Password, request.Role, cancellationToken);
        return result is { Status: UserOpStatus.Ok, User: { } user }
            ? Created($"/api/admin/users/{user.Id}", user)
            : ToProblem(result);
    }

    [HttpPut("{id:guid}/role")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> ChangeRole(Guid id, ChangeRoleRequest request, CancellationToken cancellationToken) =>
        ToResponse(await userAdminService.ChangeRoleAsync(id, request.Role, cancellationToken));

    [HttpPost("{id:guid}/disable")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Disable(Guid id, CancellationToken cancellationToken) =>
        ToResponse(await userAdminService.DisableAsync(id, cancellationToken));

    [HttpPost("{id:guid}/enable")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Enable(Guid id, CancellationToken cancellationToken) =>
        ToResponse(await userAdminService.EnableAsync(id, cancellationToken));

    private IActionResult ToResponse(UserOpResult result) =>
        result.Status == UserOpStatus.Ok ? NoContent() : ToProblem(result);

    private ObjectResult ToProblem(UserOpResult result) => Problem(
        detail: result.Reason,
        statusCode: result.Status switch
        {
            UserOpStatus.NotFound => StatusCodes.Status404NotFound,
            UserOpStatus.Conflict => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status400BadRequest,
        });
}
