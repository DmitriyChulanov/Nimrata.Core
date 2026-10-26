using System.Diagnostics.CodeAnalysis;
using Microsoft.AspNetCore.Identity;

namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Правила и хеширование паролей
/// </summary>
public static class Passwords
{
    /// <summary>
    /// Минимальная длина пароля
    /// </summary>
    public const int MinLength = 8;

    private static readonly PasswordHasher<object> Hasher = new();

    /// <summary>
    /// Удовлетворяет ли пароль требованиям к длине
    /// </summary>
    public static bool IsAcceptable([NotNullWhen(true)] string? password) => password is { Length: >= MinLength };

    /// <summary>
    /// Хеширует пароль для хранения
    /// </summary>
    /// <param name="password">Пароль в открытом виде</param>
    /// <returns>Хеш пароля</returns>
    public static string Hash(string password) => Hasher.HashPassword(new object(), password);

    /// <summary>
    /// Совпадает ли пароль с хешем
    /// </summary>
    public static bool Verify(string hash, string password) =>
        Hasher.VerifyHashedPassword(new object(), hash, password) != PasswordVerificationResult.Failed;
}
