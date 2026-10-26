namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Страница журнала и общее число записей, подходящих под фильтр
/// </summary>
public sealed record JournalPage(IReadOnlyList<JournalEntry> Items, long Total);
