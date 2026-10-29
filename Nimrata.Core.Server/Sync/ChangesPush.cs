using Nimrata.Core.Server.Objects;

namespace Nimrata.Core.Server.Sync;

/// <summary>
/// Сообщение push <c>changes</c>: формат догона <see cref="ChangesBatch"/> и курсор, с которого он прочитан
/// </summary>
/// <param name="FromSeq">Курсор, после которого прочитаны наборы; клиент с курсором меньше этого пропустил изменения и догоняет</param>
/// <param name="ToSeq">Новый курсор</param>
/// <param name="ChangesetIds">Идентификаторы наборов по порядку <c>seq</c></param>
/// <param name="Upserts">Финальное состояние затронутых видимых объектов</param>
/// <param name="Deletes">Удалённые или скрытые объекты</param>
public sealed record ChangesPush(
    long FromSeq,
    long ToSeq,
    IReadOnlyList<Guid> ChangesetIds,
    IReadOnlyList<ObjectRecord> Upserts,
    IReadOnlyList<Guid> Deletes);
