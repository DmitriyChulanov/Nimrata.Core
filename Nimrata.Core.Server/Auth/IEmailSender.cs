namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Отправка писем; в тестах подменяется поддельной реализацией
/// </summary>
public interface IEmailSender
{
    /// <summary>
    /// Отправляет письмо
    /// </summary>
    /// <param name="message">Письмо для отправки</param>
    /// <param name="cancellationToken">Токен отмены</param>
    /// <returns>Задача отправки</returns>
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}
