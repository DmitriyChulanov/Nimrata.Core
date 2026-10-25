using System.Security.Claims;

namespace Nimrata.Core.Server.Auth;

public static class ClaimsPrincipalExtensions
{
    /// <summary>Идентификатор аутентифицированного пользователя из claim <c>sub</c></summary>
    /// <exception cref="InvalidOperationException">В токене нет идентификатора пользователя</exception>
    public static Guid GetUserId(this ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue("sub") ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(value, out var id)
            ? id
            : throw new InvalidOperationException("В токене нет идентификатора пользователя.");
    }
}
