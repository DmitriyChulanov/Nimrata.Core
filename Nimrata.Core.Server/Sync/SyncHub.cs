using Microsoft.AspNetCore.SignalR;
using Nimrata.Core.Server.Auth;

namespace Nimrata.Core.Server.Sync;

/// <summary>
/// Хаб push-синхронизации <c>/api/sync</c>. Клиент только слушает: <c>changes</c> (формат догона) и <c>resync</c>.
/// Соединение входит в группу своего пользователя; вызывать методы сервера клиенту не нужно
/// </summary>
/// <param name="dispatcher">Диспетчер рассылки: учитывает, у кого есть соединения</param>
public sealed class SyncHub(ChangeDispatcher dispatcher) : Hub
{
    /// <summary>
    /// Путь хаба; JWT из query <c>access_token</c> принимается только здесь
    /// </summary>
    public const string Path = "/api/sync";

    /// <summary>
    /// Имя группы рассылки пользователя
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <returns>Имя группы <c>user:{id}</c></returns>
    public static string GroupOf(Guid userId) => $"user:{userId}";

    /// <summary>
    /// Добавляет соединение в группу пользователя
    /// </summary>
    /// <returns>Задача подключения</returns>
    public override async Task OnConnectedAsync()
    {
        var userId = Context.User!.GetUserId();
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupOf(userId), Context.ConnectionAborted);
        dispatcher.ConnectionOpened(userId);
        await base.OnConnectedAsync();
    }

    /// <summary>
    /// Снимает учёт соединения; из группы SignalR убирает его сам
    /// </summary>
    /// <param name="exception">Причина разрыва, если он аварийный</param>
    /// <returns>Задача отключения</returns>
    public override Task OnDisconnectedAsync(Exception? exception)
    {
        dispatcher.ConnectionClosed(Context.User!.GetUserId());
        return base.OnDisconnectedAsync(exception);
    }
}
