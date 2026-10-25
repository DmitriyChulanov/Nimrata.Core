using Microsoft.Extensions.Options;

namespace Nimrata.Core.Server.Auth;

/// <summary>Создаёт первого администратора из настроек развёртывания; повторный запуск дубль не создаёт.</summary>
public sealed class AdminSeeder(AuthService авторизация, IOptions<AdminSeedOptions> настройки)
{
    public async Task Выполнить()
    {
        var o = настройки.Value;
        if (string.IsNullOrWhiteSpace(o.Email) || string.IsNullOrEmpty(o.Password)) return;
        await авторизация.СоздатьПользователя(o.Email.Trim(), o.Password, администратор: true);
    }
}
