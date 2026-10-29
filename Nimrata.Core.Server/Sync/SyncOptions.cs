using System.ComponentModel.DataAnnotations;

namespace Nimrata.Core.Server.Sync;

/// <summary>
/// Настройки синхронизации клиента и сервера (раздел <c>Sync</c>)
/// </summary>
public sealed class SyncOptions
{
    /// <summary>
    /// Имя раздела конфигурации
    /// </summary>
    public const string Section = "Sync";

    /// <summary>
    /// Сколько наборов после курсора ещё отдаются потоком изменений; больше — ответ <c>resync</c>
    /// и клиент перечитывает данные целиком
    /// </summary>
    [Range(1, int.MaxValue)]
    public int ResyncThreshold { get; set; } = 5000;

    /// <summary>
    /// Окно рассылки push: как часто диспетчер собирает новые наборы из журнала и отправляет их клиентам
    /// </summary>
    [Range(typeof(TimeSpan), "00:00:00.001", "00:01:00")]
    public TimeSpan PushWindow { get; set; } = TimeSpan.FromMilliseconds(100);
}
