using Microsoft.Extensions.Options;

namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Создаёт первого администратора из настроек развёртывания; повторный запуск дубль не создаёт
/// </summary>
public sealed class AdminSeeder(AuthService authService, IOptions<AdminSeedOptions> options)
{
    /// <summary>
    /// Создаёт администратора, если он задан в настройках
    /// </summary>
    /// <param name="cancellationToken">Токен отмены</param>
    /// <returns>Задача создания</returns>
    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        var seed = options.Value;
        if (string.IsNullOrWhiteSpace(seed.Email) || string.IsNullOrEmpty(seed.Password))
        {
            return;
        }
        await authService.CreateUserAsync(seed.Email.Trim(), seed.Password, isAdmin: true, cancellationToken);
    }
}
