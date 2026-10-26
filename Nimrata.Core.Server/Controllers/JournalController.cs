using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Objects;

namespace Nimrata.Core.Server.Controllers;

/// <summary>
/// Чтение журнала изменений; только GET
/// </summary>
[ApiController]
public sealed class JournalController(JournalService journalService) : ControllerBase
{
    private const int MaxPageSize = 200;

    /// <summary>
    /// Записи журнала текущего пользователя от новых к старым: все или по одному объекту
    /// </summary>
    /// <param name="objectId">Объект, по которому нужны записи; без значения — все</param>
    /// <param name="skip">Сколько записей пропустить</param>
    /// <param name="take">Сколько записей вернуть, от 1 до 200</param>
    /// <param name="cancellationToken">Отмена запроса</param>
    /// <returns>Страница журнала с общим числом записей</returns>
    [HttpGet("api/journal")]
    [ProducesResponseType<JournalPage>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<JournalPage>> Read(
        Guid? objectId,
        [Range(0, int.MaxValue)] int skip = 0,
        [Range(1, MaxPageSize)] int take = 50,
        CancellationToken cancellationToken = default) =>
        await journalService.ReadAsync(User.GetUserId(), objectId, skip, take, cancellationToken);
}
