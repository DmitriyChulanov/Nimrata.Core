namespace Nimrata.Core.Server.Auth;

/// <summary>Настройки SMTP (раздел <c>Smtp</c>); в разработке письма перехватывает Mailpit</summary>
public sealed class SmtpOptions
{
    public const string Section = "Smtp";

    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 1025;
    public string From { get; set; } = "nimrata@localhost";
    public string? User { get; set; }
    public string? Password { get; set; }
    public bool UseSsl { get; set; }
}
