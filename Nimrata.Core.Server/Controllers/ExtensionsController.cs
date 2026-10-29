using Microsoft.AspNetCore.Mvc;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Controllers.Requests;
using Nimrata.Core.Server.Extensions;
using Nimrata.Core.Server.Sync;

namespace Nimrata.Core.Server.Controllers;

/// <summary>
/// Каталог расширений и подключения вошедшего пользователя
/// </summary>
/// <param name="extensionsService">Сервис каталога и подключений</param>
/// <param name="notifier">Push: смена подключения рассылается клиентам пользователя как <c>resync</c></param>
[ApiController]
[Route("api/extensions")]
public sealed class ExtensionsController(ExtensionsService extensionsService, IChangeNotifier notifier) : ControllerBase
{
    /// <summary>
    /// Расширения из манифестов с состоянием подключения текущего пользователя
    /// </summary>
    /// <param name="cancellationToken">Отмена запроса</param>
    /// <returns>Каталог расширений</returns>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ExtensionInfo>>> List(CancellationToken cancellationToken) =>
        Ok(await extensionsService.ListAsync(User.GetUserId(), cancellationToken));

    /// <summary>
    /// Подключает или отключает расширение для текущего пользователя
    /// </summary>
    /// <param name="id">Идентификатор расширения</param>
    /// <param name="request">Тело с полем <c>connected</c></param>
    /// <param name="cancellationToken">Отмена запроса</param>
    /// <returns>Обновлённый элемент каталога или 404, если расширения нет</returns>
    [HttpPut("{id}/connection")]
    [ProducesResponseType<ExtensionInfo>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ExtensionInfo>> SetConnection(
        string id, SetConnectionRequest request, CancellationToken cancellationToken)
    {
        var userId = User.GetUserId();
        var extension = await extensionsService.SetConnectionAsync(userId, id, request.Connected!.Value, cancellationToken);
        if (extension is null)
        {
            return NotFound();
        }
        // Видимость объектов и типов изменилась: открытые вкладки перечитывают данные целиком
        notifier.Resync(userId);
        return Ok(extension);
    }
}
