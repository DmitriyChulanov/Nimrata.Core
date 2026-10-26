using System.Text.Json;

namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Запись журнала изменений; <see cref="Old"/>, <see cref="New"/> и <see cref="Snapshot"/> заполнены не для всех операций
/// </summary>
public sealed record JournalEntry(
    long Id,
    Guid ChangesetId,
    DateTime At,
    string User,
    Guid ObjectId,
    string Operation,
    string? Property,
    JsonElement? Old,
    JsonElement? New,
    JsonElement? Snapshot);
