using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Controllers.Requests;
using Nimrata.Core.Server.Controllers.Responses;

namespace Nimrata.Core.Server.Controllers;

/// <summary>
/// Вход, обновление и отзыв токенов, сброс пароля
/// </summary>
/// <param name="authService">Сервис входа и токенов</param>
/// <param name="passwordResetService">Сервис сброса пароля</param>
/// <param name="jwtOptions">Настройки JWT</param>
[ApiController]
[Route("api/auth")]
public sealed class AuthController(
    AuthService authService, PasswordResetService passwordResetService, IOptions<JwtOptions> jwtOptions)
    : ControllerBase
{
    private const string RefreshCookie = "refresh_token";

    /// <summary>
    /// Всегда отвечает одинаково, не раскрывая, есть ли такой пользователь
    /// </summary>
    /// <param name="request">Адрес, на который нужно выслать ссылку</param>
    /// <param name="cancellationToken">Токен отмены запроса</param>
    /// <returns>Всегда 202 Accepted</returns>
    [AllowAnonymous]
    [HttpPost("forgot-password")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(request.Email))
        {
            await passwordResetService.RequestByEmailAsync(request.Email.Trim(), cancellationToken);
        }
        return Accepted();
    }

    /// <summary>
    /// Устанавливает новый пароль по токену из письма
    /// </summary>
    /// <param name="request">Токен и новый пароль</param>
    /// <param name="cancellationToken">Токен отмены запроса</param>
    /// <returns>204 при успехе, иначе 400</returns>
    [AllowAnonymous]
    [HttpPost("reset-password")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        var status = await passwordResetService.SetPasswordAsync(request.Token, request.Password, cancellationToken);
        return status == ResetStatus.Ok
            ? NoContent()
            : Problem(
                detail: $"Ссылка недействительна или устарела, либо пароль короче {Passwords.MinLength} символов.",
                statusCode: StatusCodes.Status400BadRequest);
    }

    /// <summary>
    /// Проверяет учётные данные и выдаёт access-токен и refresh-cookie
    /// </summary>
    /// <param name="request">Адрес и пароль</param>
    /// <param name="cancellationToken">Токен отмены запроса</param>
    /// <returns>Access-токен или 401</returns>
    [AllowAnonymous]
    [HttpPost("login")]
    [ProducesResponseType<TokenResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<TokenResponse>> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
        {
            return Unauthorized();
        }
        var result = await authService.LoginAsync(request.Email.Trim(), request.Password, cancellationToken);
        return result is null ? Unauthorized() : IssueTokens(result);
    }

    /// <summary>
    /// Обменивает refresh-cookie на новую пару токенов
    /// </summary>
    /// <param name="cancellationToken">Токен отмены запроса</param>
    /// <returns>Новый access-токен или 401</returns>
    [AllowAnonymous]
    [HttpPost("refresh")]
    [ProducesResponseType<TokenResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<TokenResponse>> Refresh(CancellationToken cancellationToken)
    {
        if (!Request.Cookies.TryGetValue(RefreshCookie, out var token) || string.IsNullOrEmpty(token))
        {
            return Unauthorized();
        }
        var result = await authService.RefreshAsync(token, cancellationToken);
        if (result is null)
        {
            Response.Cookies.Delete(RefreshCookie, CreateCookieOptions(null));
            return Unauthorized();
        }
        return IssueTokens(result);
    }

    /// <summary>
    /// Отзывает refresh-токен и удаляет cookie
    /// </summary>
    /// <param name="cancellationToken">Токен отмены запроса</param>
    /// <returns>204 No Content</returns>
    [AllowAnonymous]
    [HttpPost("logout")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        if (Request.Cookies.TryGetValue(RefreshCookie, out var token) && !string.IsNullOrEmpty(token))
        {
            await authService.LogoutAsync(token, cancellationToken);
        }
        Response.Cookies.Delete(RefreshCookie, CreateCookieOptions(null));
        return NoContent();
    }

    /// <summary>
    /// Возвращает данные текущего пользователя из токена
    /// </summary>
    /// <returns>Идентификатор, адрес и признак администратора</returns>
    [HttpGet("me")]
    public ActionResult<CurrentUserResponse> Me() => new CurrentUserResponse(
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"),
        User.FindFirstValue(ClaimTypes.Email) ?? User.FindFirstValue("email"),
        User.IsInRole(Roles.Admin));

    /// <summary>
    /// Записывает refresh-cookie и формирует ответ с access-токеном
    /// </summary>
    /// <param name="result">Выданная пара токенов</param>
    /// <returns>Ответ с access-токеном и сроком его жизни</returns>
    private TokenResponse IssueTokens(AuthResult result)
    {
        Response.Cookies.Append(RefreshCookie, result.RefreshToken, CreateCookieOptions(result.RefreshExpiresAt));
        return new TokenResponse(result.AccessToken, jwtOptions.Value.AccessMinutes * 60);
    }

    /// <summary>
    /// Создаёт параметры refresh-cookie: только HTTP, Strict, путь авторизации
    /// </summary>
    /// <param name="expiresAt">Срок действия cookie; null удаляет cookie</param>
    /// <returns>Параметры cookie</returns>
    private CookieOptions CreateCookieOptions(DateTimeOffset? expiresAt) => new()
    {
        HttpOnly = true,
        SameSite = SameSiteMode.Strict,
        Secure = Request.IsHttps,
        Path = "/api/auth",
        Expires = expiresAt,
    };
}
