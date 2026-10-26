using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Настройки JWT (раздел <c>Jwt</c>); ключ подписи задаётся user-secrets или переменной окружения
/// </summary>
public sealed class JwtOptions
{
    /// <summary>
    /// Имя раздела конфигурации
    /// </summary>
    public const string Section = "Jwt";

    /// <summary>
    /// Минимальная длина ключа подписи в байтах
    /// </summary>
    public const int MinKeyBytes = 32;

    /// <summary>
    /// Секретный ключ подписи токенов
    /// </summary>
    public string Key { get; set; } = "";
    /// <summary>
    /// Издатель токенов
    /// </summary>
    public string Issuer { get; set; } = "nimrata";
    /// <summary>
    /// Аудитория токенов
    /// </summary>
    public string Audience { get; set; } = "nimrata";
    /// <summary>
    /// Время жизни access-токена в минутах
    /// </summary>
    public int AccessMinutes { get; set; } = 15;
    /// <summary>
    /// Время жизни refresh-токена в днях
    /// </summary>
    public int RefreshDays { get; set; } = 30;

    /// <summary>
    /// Строит ключ подписи токенов из <see cref="Key"/>
    /// </summary>
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
