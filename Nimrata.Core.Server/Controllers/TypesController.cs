using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Nimrata.Core.Server.Objects;

namespace Nimrata.Core.Server.Controllers;

/// <summary>Типы платформы</summary>
[ApiController]
[Route("api/types")]
public sealed class TypesController(TypesService typesService) : ControllerBase
{
    /// <summary>Все типы платформы: определение из манифеста плюс <c>module</c> и <c>moduleVersion</c></summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<JsonObject>>> List(CancellationToken cancellationToken) =>
        Ok(await typesService.ListAsync(cancellationToken));
}
