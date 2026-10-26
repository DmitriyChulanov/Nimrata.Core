using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Options;

namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Отправка по SMTP (Mailpit в разработке)
/// </summary>
public sealed class SmtpEmailSender(IOptions<SmtpOptions> options) : IEmailSender
{
    /// <inheritdoc/>
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        var smtp = options.Value;
        using var client = new SmtpClient(smtp.Host, smtp.Port) { EnableSsl = smtp.UseSsl };
        if (!string.IsNullOrEmpty(smtp.User))
        {
            client.Credentials = new NetworkCredential(smtp.User, smtp.Password);
        }
        using var mail = new MailMessage(smtp.From, message.To, message.Subject, message.Body);
        await client.SendMailAsync(mail, cancellationToken);
    }
}
