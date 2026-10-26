using System.Security.Cryptography;
using System.Text;

namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Выпуск случайных непрозрачных токенов (refresh, сброс пароля) и их хеширование для хранения
/// </summary>
public static class OpaqueTokens
{
    private const int SizeBytes = 32;

    /// <summary>
    /// Создаёт новый случайный токен
    /// </summary>
    /// <returns>Токен и его хеш для хранения</returns>
    public static OpaqueToken Create()
    {
        var value = Convert.ToBase64String(RandomNumberGenerator.GetBytes(SizeBytes))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return new OpaqueToken(value, Hash(value));
    }

    /// <summary>
    /// Считает хеш токена для хранения
    /// </summary>
    /// <param name="value">Токен в открытом виде</param>
    /// <returns>Хеш в шестнадцатеричном виде</returns>
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
