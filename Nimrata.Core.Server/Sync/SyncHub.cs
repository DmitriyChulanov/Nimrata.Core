using Microsoft.AspNetCore.SignalR;
using Nimrata.Core.Server.Auth;

namespace Nimrata.Core.Server.Sync;

/// <summary>
/// Хаб push-синхронизации <c>/api/sync</c>. Клиент только слушает: <c>changes</c> (формат догона) и <c>resync</c>
/// (<see cref="ChangeDispatcher.ChangesMessage"/>, <see cref="ChangeDispatcher.ResyncMessage"/>); вызывать методы
/// сервера клиенту не нужно. Соединения учитывает диспетчер: каждому он отправляет сообщения отдельно;
/// клиентская сторона — <c>nimrata.core.client/src/platform/sync/signalrChannel.ts</c>
/// </summary>
/// <param name="dispatcher">Диспетчер рассылки: учитывает соединения пользователей</param>
public sealed class SyncHub(ChangeDispatcher dispatcher) : Hub
{
    /// <summary>
    /// Путь хаба; JWT из query <c>access_token</c> принимается только здесь. Тот же путь — в <c>signalrChannel.ts</c>
    /// </summary>
    public const string Path = "/api/sync";

    /// <summary>
    /// Учитывает соединение у диспетчера рассылки
    /// </summary>
    /// <returns>Задача подключения</returns>
    public override Task OnConnectedAsync()
    {
        dispatcher.ConnectionOpened(Context.User!.GetUserId(), Context.ConnectionId);
        return base.OnConnectedAsync();
    }

    /// <summary>
    /// Снимает учёт соединения
    /// </summary>
    /// <param name="exception">Причина разрыва, если он аварийный</param>
    /// <returns>Задача отключения</returns>
    public override Task OnDisconnectedAsync(Exception? exception)
    {
        dispatcher.ConnectionClosed(Context.User!.GetUserId(), Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}
