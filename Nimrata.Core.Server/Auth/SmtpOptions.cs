namespace Nimrata.Core.Server.Auth;

/// <summary>
/// Настройки SMTP (раздел <c>Smtp</c>); в разработке письма перехватывает Mailpit
/// </summary>
public sealed class SmtpOptions
{
    /// <summary>
    /// Имя раздела конфигурации
    /// </summary>
    public const string Section = "Smtp";

    /// <summary>
    /// Адрес SMTP-сервера
    /// </summary>
    public string Host { get; set; } = "localhost";
    /// <summary>
    /// Порт SMTP-сервера
    /// </summary>
    public int Port { get; set; } = 1025;
    /// <summary>
    /// Адрес отправителя писем
    /// </summary>
    public string From { get; set; } = "nimrata@localhost";
    /// <summary>
    /// Логин SMTP; если пуст, авторизация не используется
    /// </summary>
    public string? User { get; set; }
    /// <summary>
    /// Пароль SMTP
    /// </summary>
    public string? Password { get; set; }
    /// <summary>
    /// Включать ли TLS при соединении с SMTP-сервером
    /// </summary>
    public bool UseSsl { get; set; }
}
