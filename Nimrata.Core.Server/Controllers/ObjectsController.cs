using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Objects;

namespace Nimrata.Core.Server.Controllers;

/// <summary>
/// Объекты пользователя и пакетное применение наборов изменений
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
    /// Применяет пакет наборов изменений <c>{ changesets: [{ id, operations }] }</c>: каждый набор атомарно
    /// и независимо от остальных, отказ одного не откатывает другие
    /// </summary>
    /// <param name="body">Пакет наборов в JSON</param>
    /// <param name="cancellationToken">Токен отмены запроса</param>
    /// <returns>
    /// Итог каждого набора в порядке пакета (<c>applied</c>, <c>duplicate</c>, <c>rejected</c>);
    /// 400 — только при ошибке формата пакета
    /// </returns>
    [HttpPost("api/changesets")]
    [ProducesResponseType<IReadOnlyList<ChangesetResult>>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<IReadOnlyList<ChangesetResult>>> Apply(
        [FromBody] JsonElement body, CancellationToken cancellationToken)
    {
        if (!ChangesetSubmission.TryParseBatch(body, out var submissions, out var error))
        {
            return Problem(detail: error, statusCode: StatusCodes.Status400BadRequest);
        }
        return Ok(await changesetService.ApplyBatchAsync(User.GetUserId(), submissions, cancellationToken));
    }
}
