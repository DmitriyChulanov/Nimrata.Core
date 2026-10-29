namespace Nimrata.Core.Server.Controllers.Responses;

/// <summary>
/// Ответ догона «перечитайте всё»: изменений после курсора слишком много или курсор неизвестен серверу
/// </summary>
/// <param name="Resync">Всегда <c>true</c></param>
public sealed record ResyncResponse(bool Resync = true);
