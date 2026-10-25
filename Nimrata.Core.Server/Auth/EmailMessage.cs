namespace Nimrata.Core.Server.Auth;

/// <summary>Исходящее письмо</summary>
public sealed record EmailMessage(string To, string Subject, string Body);
