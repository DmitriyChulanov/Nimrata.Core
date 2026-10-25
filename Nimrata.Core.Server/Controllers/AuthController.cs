using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Nimrata.Core.Server.Auth;

namespace Nimrata.Core.Server.Controllers;

public sealed record LoginRequest(string? Email, string? Password);

public sealed record ForgotPasswordRequest(string? Email);

public sealed record ResetPasswordRequest(string? Token, string? Password);

[ApiController]
[Route("api/auth")]
public sealed class AuthController(
    AuthService авторизация, PasswordResetService сброс, IOptions<JwtOptions> настройки) : ControllerBase
{
    private const string RefreshCookie = "refresh_token";

    /// <summary>Всегда отвечает одинаково, не раскрывая, есть ли такой пользователь.</summary>
    [AllowAnonymous]
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest запрос)
    {
        if (!string.IsNullOrWhiteSpace(запрос.Email))
        {
            await сброс.ЗапроситьПоEmail(запрос.Email.Trim());
        }
        return Accepted();
    }

    [AllowAnonymous]
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest запрос)
    {
        var результат = await сброс.УстановитьПароль(запрос.Token, запрос.Password);
        return результат == ResetStatus.Ok
            ? NoContent()
            : BadRequest(new
            {
                error = $"Ссылка недействительна или устарела, либо пароль короче {AuthService.MinPasswordLength} символов.",
            });
    }

    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest запрос)
    {
        if (string.IsNullOrWhiteSpace(запрос.Email) || string.IsNullOrEmpty(запрос.Password))
        {
            return Unauthorized();
        }
        var результат = await авторизация.Войти(запрос.Email.Trim(), запрос.Password);
        return результат is null ? Unauthorized() : Выдать(результат);
    }

    [AllowAnonymous]
    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh()
    {
        if (!Request.Cookies.TryGetValue(RefreshCookie, out var токен) || string.IsNullOrEmpty(токен))
        {
            return Unauthorized();
        }
        var результат = await авторизация.Обновить(токен);
        if (результат is null)
        {
            Response.Cookies.Delete(RefreshCookie, ПараметрыCookie(null));
            return Unauthorized();
        }
        return Выдать(результат);
    }

    [AllowAnonymous]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        if (Request.Cookies.TryGetValue(RefreshCookie, out var токен) && !string.IsNullOrEmpty(токен))
        {
            await авторизация.Выйти(токен);
        }
        Response.Cookies.Delete(RefreshCookie, ПараметрыCookie(null));
        return NoContent();
    }

    [HttpGet("me")]
    public IActionResult Me() => Ok(new
    {
        id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"),
        email = User.FindFirstValue(ClaimTypes.Email) ?? User.FindFirstValue("email"),
        isAdmin = User.IsInRole("admin"),
    });

    private IActionResult Выдать(AuthResult результат)
    {
        Response.Cookies.Append(RefreshCookie, результат.RefreshToken, ПараметрыCookie(результат.RefreshExpiresAt));
        return Ok(new { accessToken = результат.AccessToken, expiresIn = настройки.Value.AccessMinutes * 60 });
    }

    private CookieOptions ПараметрыCookie(DateTimeOffset? истекает) => new()
    {
        HttpOnly = true,
        SameSite = SameSiteMode.Strict,
        Secure = Request.IsHttps,
        Path = "/api/auth",
        Expires = истекает,
    };
}
