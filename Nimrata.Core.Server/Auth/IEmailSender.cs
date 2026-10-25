namespace Nimrata.Core.Server.Auth;

/// <summary>Отправка писем; в тестах подменяется поддельной реализацией</summary>
public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}
