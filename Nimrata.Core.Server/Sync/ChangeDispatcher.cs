using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

namespace Nimrata.Core.Server.Sync;

/// <summary>
/// Диспетчер push внутри процесса. Фиксация набора помечает пользователя «грязным»; первое такое уведомление
/// открывает окно рассылки (<see cref="SyncOptions.PushWindow"/>), по его истечении диспетчер читает журнал из БД
/// после последнего отправленного <c>seq</c> (<see cref="SyncService.ReadChangesAsync"/>) и отправляет группе
/// пользователя одно сообщение <c>changes</c>. Если наборов накопилось больше порога resync — например, клиент
/// медленно принимает и рассылка отстала, — вместо потока уходит <c>resync</c>. Пользователи без соединений
/// не учитываются: подключившийся клиент сначала догоняет сам. Позже заменяем на <c>LISTEN/NOTIFY</c> или backplane
/// </summary>
/// <param name="sync">Чтение журнала в формате догона</param>
/// <param name="hub">Рассылка клиентам хаба</param>
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
    /// Состояние рассылки одного пользователя; доступ под блокировкой <see cref="_users"/>
    /// </summary>
    private sealed class UserState
    {
        /// <summary>
        /// Открытые соединения пользователя
        /// </summary>
        public int Connections;

        /// <summary>
        /// Курсор последнего отправленного сообщения; <c>null</c> — ещё ничего не отправляли (или был resync)
        /// </summary>
        public long? LastSent;

        /// <summary>
        /// Наименьший курсор, после которого есть неразосланные наборы; <c>null</c> — нет
        /// </summary>
        public long? From;

        /// <summary>
        /// Нужно разослать <c>resync</c>
        /// </summary>
        public bool Resync;

        /// <summary>
        /// Окно рассылки открыто или идёт отправка
        /// </summary>
        public bool Scheduled;
    }

    private readonly Dictionary<Guid, UserState> _users = [];
    private readonly CancellationTokenSource _stopping = new();

    /// <summary>
    /// Учитывает новое соединение пользователя
    /// </summary>
    /// <param name="userId">Пользователь</param>
    public void ConnectionOpened(Guid userId)
    {
        lock (_users)
        {
            if (!_users.TryGetValue(userId, out var state))
            {
                state = new UserState();
                _users[userId] = state;
            }
            state.Connections++;
        }
    }

    /// <summary>
    /// Снимает учёт соединения; без соединений состояние пользователя забывается
    /// </summary>
    /// <param name="userId">Пользователь</param>
    public void ConnectionClosed(Guid userId)
    {
        lock (_users)
        {
            if (!_users.TryGetValue(userId, out var state))
            {
                return;
            }
            state.Connections--;
            if (state.Connections <= 0 && !state.Scheduled)
            {
                _users.Remove(userId);
            }
        }
    }

    /// <inheritdoc />
    public void Changed(Guid userId, long seq) => Mark(userId, state =>
        // Уведомления могут прийти не в порядке seq: курсор «откатывается» к самому раннему, повтор безопасен
        state.From = Math.Min(state.From ?? long.MaxValue, seq - 1));

    /// <inheritdoc />
    public void Resync(Guid userId) => Mark(userId, state => state.Resync = true);

    /// <summary>
    /// Помечает пользователя с соединениями и открывает окно рассылки, если оно ещё не открыто
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <param name="mark">Что именно надо разослать</param>
    private void Mark(Guid userId, Action<UserState> mark)
    {
        lock (_users)
        {
            if (!_users.TryGetValue(userId, out var state) || state.Connections <= 0)
            {
                return;
            }
            mark(state);
            if (state.Scheduled)
            {
                return;
            }
            state.Scheduled = true;
        }
        _ = Task.Run(() => RunAsync(userId));
    }

    /// <summary>
    /// Окно за окном рассылает накопившееся, пока пользователь снова и снова помечается
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <returns>Задача рассылки</returns>
    private async Task RunAsync(Guid userId)
    {
        var cancellationToken = _stopping.Token;
        try
        {
            while (true)
            {
                await Task.Delay(options.Value.PushWindow, timeProvider, cancellationToken);

                long? since;
                bool resync;
                lock (_users)
                {
                    var state = _users[userId];
                    resync = state.Resync;
                    since = state.LastSent is { } last && state.From is { } from ? Math.Min(last, from) : state.LastSent ?? state.From;
                    state.Resync = false;
                    state.From = null;
                }

                var sent = await DispatchAsync(userId, since, resync, cancellationToken);

                lock (_users)
                {
                    var state = _users[userId];
                    state.LastSent = sent;
                    if (state.Resync || state.From is not null)
                    {
                        continue;
                    }
                    state.Scheduled = false;
                    if (state.Connections <= 0)
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
    /// Отправляет группе пользователя одно сообщение
    /// </summary>
    /// <param name="userId">Пользователь</param>
    /// <param name="since">Курсор, после которого читать журнал; <c>null</c> — изменений нет</param>
    /// <param name="resync">Отправить <c>resync</c> вместо изменений</param>
    /// <param name="cancellationToken">Остановка сервера</param>
    /// <returns>Новый «последний отправленный» курсор; <c>null</c> после <c>resync</c></returns>
    private async Task<long?> DispatchAsync(Guid userId, long? since, bool resync, CancellationToken cancellationToken)
    {
        var group = hub.Clients.Group(SyncHub.GroupOf(userId));
        try
        {
            var batch = !resync && since is { } cursor
                ? await sync.ReadChangesAsync(userId, Math.Max(cursor, 0), cancellationToken)
                : null;
            if (resync || (since is not null && batch is null))
            {
                await group.SendAsync("resync", cancellationToken);
                return null;
            }
            if (batch is null || batch.ChangesetIds.Count == 0)
            {
                return since;
            }
            await group.SendAsync(
                "changes",
                new ChangesPush(since!.Value, batch.ToSeq, batch.ChangesetIds, batch.Upserts, batch.Deletes),
                cancellationToken);
            return batch.ToSeq;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Рассылка не удалась: в следующем окне клиенты получат resync (без чтения БД) и перечитают всё
            logger.LogError(exception, "Не удалось разослать изменения пользователя {UserId}", userId);
            if (!resync)
            {
                lock (_users)
                {
                    _users[userId].Resync = true;
                }
            }
            return null;
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
