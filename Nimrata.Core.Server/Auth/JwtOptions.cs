using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Nimrata.Core.Server.Auth;

/// <summary>Настройки JWT (раздел <c>Jwt</c>); ключ подписи задаётся user-secrets или переменной окружения</summary>
public sealed class JwtOptions
{
    public const string Section = "Jwt";

    /// <summary>Минимальная длина ключа подписи в байтах</summary>
    public const int MinKeyBytes = 32;

    public string Key { get; set; } = "";
    public string Issuer { get; set; } = "nimrata";
    public string Audience { get; set; } = "nimrata";
    public int AccessMinutes { get; set; } = 15;
    public int RefreshDays { get; set; } = 30;

    /// <summary>Строит ключ подписи токенов из <see cref="Key"/></summary>
    /// <exception cref="InvalidOperationException">Ключ не задан или короче <see cref="MinKeyBytes"/> байт</exception>
    public SymmetricSecurityKey CreateSigningKey()
    {
        var bytes = Encoding.UTF8.GetBytes(Key);
        if (bytes.Length < MinKeyBytes)
        {
            throw new InvalidOperationException(
                $"Не задан ключ подписи JWT (Jwt:Key, не короче {MinKeyBytes} байт): user-secrets или переменная Jwt__Key.");
        }
        return new SymmetricSecurityKey(bytes);
    }
}
