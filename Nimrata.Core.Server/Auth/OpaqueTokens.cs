using System.Security.Cryptography;
using System.Text;

namespace Nimrata.Core.Server.Auth;

/// <summary>Выпуск случайных непрозрачных токенов (refresh, сброс пароля) и их хеширование для хранения</summary>
public static class OpaqueTokens
{
    private const int SizeBytes = 32;

    public static OpaqueToken Create()
    {
        var value = Convert.ToBase64String(RandomNumberGenerator.GetBytes(SizeBytes))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return new OpaqueToken(value, Hash(value));
    }

    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
