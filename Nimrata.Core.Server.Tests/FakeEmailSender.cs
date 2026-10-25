using Nimrata.Core.Server.Auth;

namespace Nimrata.Core.Server.Tests;

/// <summary>Почтовый отправитель, который складывает письма в память</summary>
public sealed class FakeEmailSender : IEmailSender
{
    private readonly List<EmailMessage> _emails = [];

    public IReadOnlyList<EmailMessage> Emails
    {
        get { lock (_emails) return [.. _emails]; }
    }

    public Task SendAsync(EmailMessage email, CancellationToken cancellationToken = default)
    {
        lock (_emails) _emails.Add(email);
        return Task.CompletedTask;
    }
}
