using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Controllers.Responses;
using Nimrata.Core.Server.Objects;

namespace Nimrata.Core.Server.Controllers;

/// <summary>
/// Объекты пользователя и применение наборов изменений
/// </summary>
/// <param name="objectsService">Сервис чтения объектов</param>
/// <param name="changesetService">Сервис применения наборов изменений</param>
[ApiController]
public sealed class ObjectsController(ObjectsService objectsService, ChangesetService changesetService) : ControllerBase
{
    /// <summary>
    /// Все объекты текущего пользователя и только они
    /// </summary>
    /// <param name="cancellationToken">Токен отмены запроса</param>
    /// <returns>Список объектов пользователя</returns>
    [HttpGet("api/objects")]
    public async Task<ActionResult<IReadOnlyList<ObjectRecord>>> Load(CancellationToken cancellationToken) =>
        Ok(await objectsService.LoadAsync(User.GetUserId(), cancellationToken));

    /// <summary>
    /// Применяет набор изменений целиком или отклоняет его с причиной
    /// </summary>
    /// <param name="body">Набор изменений в JSON</param>
    /// <param name="cancellationToken">Токен отмены запроса</param>
    /// <returns>Идентификатор применённого набора, 409 при конфликте или 422 при отклонении</returns>
    [HttpPost("api/changesets")]
    [ProducesResponseType<ChangesetResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<ChangesetResponse>> Apply(
        [FromBody] JsonElement body, CancellationToken cancellationToken)
    {
        try
        {
            var id = await changesetService.ApplyAsync(User.GetUserId(), body, cancellationToken);
            return new ChangesetResponse(id);
        }
        catch (ChangesetRejectedException rejection)
        {
            return Problem(
                detail: rejection.Message,
                statusCode: rejection.Conflict
                    ? StatusCodes.Status409Conflict
                    : StatusCodes.Status422UnprocessableEntity);
        }
    }
}
