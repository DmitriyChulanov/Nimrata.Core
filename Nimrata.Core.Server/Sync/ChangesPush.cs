namespace Nimrata.Core.Server.Sync;

/// <summary>
/// Сообщение push <c>changes</c>: формат догона <see cref="ChangesBatch"/> плюс курсор, с которого он прочитан.
/// В JSON поля пакета и <c>fromSeq</c> лежат на одном уровне
/// </summary>
public sealed record ChangesPush : ChangesBatch
{
    /// <summary>
    /// Сообщение из прочитанного пакета догона
    /// </summary>
    /// <param name="fromSeq">Курсор, после которого прочитаны наборы</param>
    /// <param name="batch">Пакет догона после <paramref name="fromSeq"/></param>
    public ChangesPush(long fromSeq, ChangesBatch batch)
        : base(batch)
    {
        FromSeq = fromSeq;
    }

    /// <summary>
    /// Курсор, после которого прочитаны наборы; клиент с курсором меньше этого пропустил изменения и догоняет
    /// </summary>
    public long FromSeq { get; }
}
