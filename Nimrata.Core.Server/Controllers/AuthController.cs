using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Nimrata.Core.Server.Auth;
using Nimrata.Core.Server.Controllers.Requests;
using Nimrata.Core.Server.Controllers.Responses;

namespace Nimrata.Core.Server.Controllers;

/// <summary>Вход, обновление и отзыв токенов, сброс пароля</summary>
[ApiController]
[Route("api/auth")]
public sealed class AuthController(
    AuthService authService, PasswordResetService passwordResetService, IOptions<JwtOptions> jwtOptions)
    : ControllerBase
{
    private const string RefreshCookie = "refresh_token";

    /// <summary>Всегда отвечает одинаково, не раскрывая, есть ли такой пользователь</summary>
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

    [HttpGet("me")]
    public ActionResult<CurrentUserResponse> Me() => new CurrentUserResponse(
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"),
        User.FindFirstValue(ClaimTypes.Email) ?? User.FindFirstValue("email"),
        User.IsInRole(Roles.Admin));

    private TokenResponse IssueTokens(AuthResult result)
    {
        Response.Cookies.Append(RefreshCookie, result.RefreshToken, CreateCookieOptions(result.RefreshExpiresAt));
        return new TokenResponse(result.AccessToken, jwtOptions.Value.AccessMinutes * 60);
    }

    private CookieOptions CreateCookieOptions(DateTimeOffset? expiresAt) => new()
    {
        HttpOnly = true,
        SameSite = SameSiteMode.Strict,
        Secure = Request.IsHttps,
        Path = "/api/auth",
        Expires = expiresAt,
    };
}
