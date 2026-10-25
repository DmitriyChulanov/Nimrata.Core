using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Options;

namespace Nimrata.Core.Server.Auth;

/// <summary>Отправка по SMTP (Mailpit в разработке).</summary>
public sealed class SmtpEmailSender(IOptions<SmtpOptions> настройки) : IEmailSender
{
    public async Task Отправить(Письмо письмо)
    {
        var o = настройки.Value;
        using var клиент = new SmtpClient(o.Host, o.Port) { EnableSsl = o.UseSsl };
        if (!string.IsNullOrEmpty(o.User))
        {
            клиент.Credentials = new NetworkCredential(o.User, o.Password);
        }
        using var сообщение = new MailMessage(o.From, письмо.Кому, письмо.Тема, письмо.Текст);
        await клиент.SendMailAsync(сообщение);
    }
}
