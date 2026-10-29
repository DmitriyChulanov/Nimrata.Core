using Nimrata.Core.Server.Objects;

namespace Nimrata.Core.Server.Sync;

/// <summary>
/// Изменения пользователя после курсора — формат догона <c>GET /api/changes</c> (и сообщений push)
/// </summary>
/// <param name="ToSeq">Новый курсор: <c>seq</c> последнего набора пользователя на момент чтения</param>
/// <param name="ChangesetIds">Идентификаторы наборов после курсора в порядке <c>seq</c>; по ним клиент узнаёт свои наборы</param>
/// <param name="Upserts">Финальное состояние видимых объектов, затронутых этими наборами</param>
/// <param name="Deletes">Затронутые объекты, которых больше нет или которые скрыты (отключённое расширение)</param>
public sealed record ChangesBatch(
    long ToSeq,
    IReadOnlyList<Guid> ChangesetIds,
    IReadOnlyList<ObjectRecord> Upserts,
    IReadOnlyList<Guid> Deletes);
