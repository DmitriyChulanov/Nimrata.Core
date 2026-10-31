using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

namespace Nimrata.Core.Server.Sync;

/// <summary>
/// Диспетчер push внутри процесса. Фиксация набора помечает соединения пользователя «грязными»; первое такое
/// уведомление открывает окно рассылки (<see cref="SyncOptions.PushWindow"/>), по его истечении диспетчер читает
/// журнал из БД (<see cref="SyncService.ReadChangesAsync"/>) после курсора, отправленного каждому соединению, и
/// отправляет ему одно сообщение <c>changes</c>. Соединения отправляются независимо: пока предыдущая отправка
/// соединению не завершилась (клиент медленно принимает), оно пропускает окна и копит курсор, остальные вкладки
/// получают поток дальше. Освободившемуся соединению уходит накопленное одним сообщением, а если наборов больше
/// порога — <c>resync</c>. Пользователи без соединений не учитываются: подключившийся клиент сначала догоняет сам;
/// позже заменяем на <c>LISTEN/NOTIFY</c> или backplane
/// </summary>
/// <remarks>
/// Имена сообщений <c>changes</c> и <c>resync</c> и путь хаба (<see cref="SyncHub.Path"/>) слушает клиент:
/// <c>nimrata.core.client/src/platform/sync/signalrChannel.ts</c>
/// </remarks>
/// <param name="sync">Чтение журнала в формате догона</param>
/// <param name="hub">Отправка сообщений соединениям хаба</param>
/// <param name="options">Окно рассылки и порог resync</param>
/// <param name="timeProvider">Часы для окна рассылки</param>
/// <param name="logger">Журнал ошибок рассылки</param>
public sealed class ChangeDispatcher(
    SyncService sync,
    IHubContext<SyncHub> hub,
    IOptions<SyncOptions> options,
    TimeProvider timeProvider,
    ILogger<ChangeDispatcher> logger) : IChangeNotifier, IDisposable
{
    /// <summary>
    /// Имя сообщения с изменениями в формате догона (<see cref="ChangesPush"/>)
    /// </summary>
    public const string ChangesMessage = "changes";

    /// <summary>
    /// Имя сообщения «перечитайте данные целиком»
    /// </summary>
    public const string ResyncMessage = "resync";

    /// <summary>
    /// Состояние рассылки одному соединению; доступ под блокировкой <see cref="_users"/>
    /// </summary>
    private sealed class ConnectionState
    {
        /// <summary>
        /// Курсор последнего отправленного соединению <c>changes</c>; <c>null</c> — ещё не отправляли (или был resync)
        /// </summary>
        public long? Sent;

        /// <summary>
        /// Наименьший курсор, после которого есть неразосланные соединению наборы; <c>null</c> — нет
        /// </summary>
        public long? From;

        /// <summary>
        /// Соединению нужно отправить <c>resync</c>
        /// </summary>
        public bool Resync;

        /// <summary>
        /// Соединение выбрано в окно или отправка ему ещё не завершилась: новых сообщений не получает
        /// </summary>
        public bool Busy;

        /// <summary>
        /// Есть что отправить
        /// </summary>
        public bool HasPending => Resync || From is not null;
    }

    /// <summary>
    /// Состояние рассылки одного пользователя; доступ под блокировкой <see cref="_users"/>
    /// </summary>
    private sealed class UserState
    {
        /// <summary>
        /// Открытые соединения пользователя по идентификатору соединения SignalR
        /// </summary>
        public Dictionary<string, ConnectionState> Connections { get; } = [];

        /// <summary>
        /// Окно рассылки открыто или идёт чтение журнала
        /// </summary>
        public bool Scheduled;
    }

    /// <summary>
    /// Что отправить соединению в этом окне
    /// </summary>
    /// <param name="ConnectionId">Соединение SignalR</param>
    /// <param name="Connection">Состояние соединения</param>
    /// <param name="Since">Курсор, после которого читать журнал; <c>null</c> — отправить <c>resync</c></param>
    private sealed record Delivery(string ConnectionId, ConnectionState Connection, long? Since);

    private readonly Dictionary<Guid, UserState> _users = [];
    private readonly CancellationTokenSource _stopping = new();

    /// <summary>
    /// Учитывает новое соединение пользователя
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <param name="connectionId">Идентификатор соединения SignalR</param>
    public void ConnectionOpened(Guid userId, string connectionId)
    {
        lock (_users)
        {
            if (!_users.TryGetValue(userId, out var state))
            {
                state = new UserState();
                _users[userId] = state;
            }
            state.Connections[connectionId] = new ConnectionState();
        }
    }

    /// <summary>
    /// Снимает учёт соединения; без соединений состояние пользователя забывается
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <param name="connectionId">Идентификатор соединения SignalR</param>
    public void ConnectionClosed(Guid userId, string connectionId)
    {
        lock (_users)
        {
            if (!_users.TryGetValue(userId, out var state))
            {
                return;
            }
            state.Connections.Remove(connectionId);
            if (state.Connections.Count == 0 && !state.Scheduled)
            {
                _users.Remove(userId);
            }
        }
    }

    /// <inheritdoc />
    public void Changed(Guid userId, long seq, long prevSeq) => Mark(userId, connection =>
        // Уведомления могут прийти не в порядке seq: курсор «откатывается» к самому раннему, повтор безопасен
        connection.From = Math.Min(connection.From ?? long.MaxValue, prevSeq));

    /// <inheritdoc />
    public void Resync(Guid userId) => Mark(userId, connection => connection.Resync = true);

    /// <summary>
    /// Помечает соединения пользователя и открывает окно рассылки, если оно ещё не открыто
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <param name="mark">Что именно надо разослать каждому соединению</param>
    private void Mark(Guid userId, Action<ConnectionState> mark)
    {
        lock (_users)
        {
            if (!_users.TryGetValue(userId, out var state) || state.Connections.Count == 0)
            {
                return;
            }
            foreach (var connection in state.Connections.Values)
            {
                mark(connection);
            }
            ScheduleLocked(userId, state);
        }
    }

    /// <summary>
    /// Открывает окно рассылки пользователя, если оно ещё не открыто; вызывается под блокировкой <see cref="_users"/>
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <param name="state">Его состояние рассылки</param>
    private void ScheduleLocked(Guid userId, UserState state)
    {
        if (state.Scheduled)
        {
            return;
        }
        state.Scheduled = true;
        _ = Task.Run(() => RunAsync(userId, state));
    }

    /// <summary>
    /// Окно за окном рассылает накопившееся, пока у свободных соединений есть что отправить
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <param name="state">Его состояние рассылки</param>
    /// <returns>Задача рассылки</returns>
    private async Task RunAsync(Guid userId, UserState state)
    {
        var cancellationToken = _stopping.Token;
        try
        {
            while (true)
            {
                await Task.Delay(options.Value.PushWindow, timeProvider, cancellationToken);
                await DispatchWindowAsync(userId, TakeDeliveries(state), cancellationToken);

                lock (_users)
                {
                    if (state.Connections.Values.Any(c => !c.Busy && c.HasPending))
                    {
                        continue;
                    }
                    state.Scheduled = false;
                    if (state.Connections.Count == 0)
                    {
                        _users.Remove(userId);
                    }
                    return;
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }

    /// <summary>
    /// Выбирает свободные соединения, которым есть что отправить, и занимает их до конца отправки
    /// </summary>
    /// <param name="state">Состояние рассылки пользователя</param>
    /// <returns>Отправки окна</returns>
    private List<Delivery> TakeDeliveries(UserState state)
    {
        lock (_users)
        {
            var deliveries = new List<Delivery>();
            foreach (var (connectionId, connection) in state.Connections)
            {
                if (connection.Busy || !connection.HasPending)
                {
                    continue;
                }
                var since = connection.Resync
                    ? (long?)null
                    : connection.Sent is { } sent ? Math.Min(sent, connection.From!.Value) : connection.From;
                connection.Busy = true;
                connection.Resync = false;
                connection.From = null;
                deliveries.Add(new Delivery(connectionId, connection, since));
            }
            return deliveries;
        }
    }

    /// <summary>
    /// Читает журнал по одному разу на каждый курсор и запускает отправки, не дожидаясь их завершения:
    /// медленное соединение не задерживает остальные
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <param name="deliveries">Отправки окна</param>
    /// <param name="cancellationToken">Остановка сервера</param>
    /// <returns>Задача чтения журнала</returns>
    private async Task DispatchWindowAsync(Guid userId, List<Delivery> deliveries, CancellationToken cancellationToken)
    {
        foreach (var group in deliveries.GroupBy(d => d.Since))
        {
            if (group.Key is not { } since)
            {
                foreach (var delivery in group)
                {
                    Start(userId, delivery, ResyncMessage, null, sent: null);
                }
                continue;
            }

            ChangesBatch? batch;
            try
            {
                batch = await sync.ReadChangesAsync(userId, Math.Max(since, 0), cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // Журнал не прочитан: в следующем окне эти соединения получат resync (без чтения БД)
                logger.LogError(exception, "Не удалось прочитать изменения пользователя {UserId}", userId);
                lock (_users)
                {
                    foreach (var delivery in group)
                    {
                        delivery.Connection.Busy = false;
                        delivery.Connection.Resync = true;
                    }
                }
                continue;
            }

            foreach (var delivery in group)
            {
                if (batch is null)
                {
                    Start(userId, delivery, ResyncMessage, null, sent: null);
                }
                else if (batch.ChangesetIds.Count == 0)
                {
                    lock (_users)
                    {
                        delivery.Connection.Busy = false;
                    }
                }
                else
                {
                    Start(userId, delivery, ChangesMessage, new ChangesPush(since, batch), sent: batch.ToSeq);
                }
            }
        }
    }

    /// <summary>
    /// Запускает отправку одному соединению; курсор соединения сдвигается сразу, чтобы следующее окно
    /// читало после него
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <param name="delivery">Соединение и его состояние</param>
    /// <param name="method">Имя сообщения клиенту</param>
    /// <param name="payload">Тело сообщения; <c>null</c> — без аргументов</param>
    /// <param name="sent">Новый курсор соединения; <c>null</c> после <c>resync</c></param>
    private void Start(Guid userId, Delivery delivery, string method, object? payload, long? sent)
    {
        lock (_users)
        {
            delivery.Connection.Sent = sent;
        }
        _ = SendAsync(userId, delivery, method, payload);
    }

    /// <summary>
    /// Отправляет сообщение соединению и освобождает его; при сбое соединению в следующем окне уходит
    /// <c>resync</c>, а накопившееся за время отправки открывает новое окно
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <param name="delivery">Соединение и его состояние</param>
    /// <param name="method">Имя сообщения клиенту</param>
    /// <param name="payload">Тело сообщения; <c>null</c> — без аргументов</param>
    /// <returns>Задача отправки; исключений не бросает</returns>
    private async Task SendAsync(Guid userId, Delivery delivery, string method, object? payload)
    {
        var failed = false;
        try
        {
            var client = hub.Clients.Client(delivery.ConnectionId);
            await (payload is null
                ? client.SendAsync(method, _stopping.Token)
                : client.SendAsync(method, payload, _stopping.Token));
        }
        catch (OperationCanceledException) when (_stopping.IsCancellationRequested)
        {
            return;
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                exception, "Не удалось отправить {Method} соединению {ConnectionId} пользователя {UserId}",
                method, delivery.ConnectionId, userId);
            failed = true;
        }

        lock (_users)
        {
            var connection = delivery.Connection;
            connection.Busy = false;
            if (failed)
            {
                connection.Sent = null;
                connection.Resync = true;
            }
            if (connection.HasPending
                && _users.TryGetValue(userId, out var state)
                && state.Connections.TryGetValue(delivery.ConnectionId, out var current)
                && ReferenceEquals(current, connection))
            {
                ScheduleLocked(userId, state);
            }
        }
    }

    /// <summary>
    /// Останавливает открытые окна рассылки
    /// </summary>
    public void Dispose()
    {
        // Источник токена не освобождаем: окна, запущенные в этот момент, ещё читают его
        _stopping.Cancel();
    }
}
