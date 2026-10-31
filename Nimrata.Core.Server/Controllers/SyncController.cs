using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Controllers.Responses;
using Nimrata.Core.Server.Sync;

namespace Nimrata.Core.Server.Controllers;

/// <summary>
/// Синхронизация клиента: догон с курсора и согласованная полная загрузка
/// </summary>
/// <param name="syncService">Сервис чтения журнала и снимков</param>
[ApiController]
public sealed class SyncController(SyncService syncService) : ControllerBase
{
    /// <summary>
    /// Изменения текущего пользователя после курсора
    /// </summary>
    /// <param name="since">Курсор клиента: <c>seq</c> последнего известного набора, целое ≥ 0</param>
    /// <param name="cancellationToken">Токен отмены запроса</param>
    /// <returns>
    /// <see cref="ChangesBatch"/> (<c>toSeq</c>, <c>changesetIds</c>, <c>upserts</c>, <c>deletes</c>) либо
    /// <c>{ resync: true }</c>, если клиенту нужно перечитать данные через <c>GET /api/snapshot</c>
    /// </returns>
    /// <remarks>
    /// Возвращает <see cref="IActionResult"/>, а не <c>ActionResult&lt;T&gt;</c>: у кода 200 два разных тела
    /// (<see cref="ChangesBatch"/> и <see cref="ResyncResponse"/>), общего типа у них нет; оба объявлены
    /// через <see cref="ProducesResponseTypeAttribute"/>
    /// </remarks>
    [HttpGet("api/changes")]
    [ProducesResponseType<ChangesBatch>(StatusCodes.Status200OK)]
    [ProducesResponseType<ResyncResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Changes(
        [FromQuery, Required, Range(0, long.MaxValue)] long? since, CancellationToken cancellationToken)
    {
        var batch = await syncService.ReadChangesAsync(User.GetUserId(), since!.Value, cancellationToken);
        return batch is null ? Ok(new ResyncResponse()) : Ok(batch);
    }

    /// <summary>
    /// Полная загрузка текущего пользователя в одном снимке БД
    /// </summary>
    /// <param name="cancellationToken">Токен отмены запроса</param>
    /// <returns>Курсор снимка, все типы и видимые объекты пользователя</returns>
    [HttpGet("api/snapshot")]
    [ProducesResponseType<SyncSnapshot>(StatusCodes.Status200OK)]
    public async Task<ActionResult<SyncSnapshot>> Snapshot(CancellationToken cancellationToken) =>
        Ok(await syncService.ReadSnapshotAsync(User.GetUserId(), cancellationToken));
}
