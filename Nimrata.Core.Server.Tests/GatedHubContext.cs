using Microsoft.AspNetCore.SignalR;
using Nimrata.Core.Server.Sync;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Контекст хаба синхронизации для тестов: отправка соединению сначала проходит через <see cref="BeforeSend"/>,
/// где тест может задержать её (медленный клиент) или уронить (сбой отправки). Отправляет через настоящий
/// <see cref="HubLifetimeManager{THub}"/>, поэтому сообщения доходят до клиентов SignalR
/// </summary>
/// <param name="lifetime">Менеджер соединений хаба сервера теста</param>
public sealed class GatedHubContext(HubLifetimeManager<SyncHub> lifetime) : IHubContext<SyncHub>
{
    private readonly HubLifetimeManager<SyncHub> _lifetime = lifetime;

    /// <summary>
    /// Вызывается перед каждой отправкой соединению: идентификатор соединения и имя сообщения;
    /// задача, которая не завершается, держит отправку; исключение — сбой отправки
    /// </summary>
    public Func<string, string, Task> BeforeSend { get; set; } = (_, _) => Task.CompletedTask;

    /// <summary>
    /// Клиенты хаба; поддерживается только отправка одному соединению
    /// </summary>
    public IHubClients Clients => new GatedClients(this);

    /// <summary>
    /// Группы не нужны диспетчеру и в тестах не поддерживаются
    /// </summary>
    /// <exception cref="NotSupportedException">Всегда</exception>
    public IGroupManager Groups => throw new NotSupportedException("Группы в тестовом контексте хаба не поддерживаются.");

    /// <summary>
    /// Клиенты хаба: отправка одному соединению через задержку теста
    /// </summary>
    /// <param name="context">Контекст с задержкой теста и менеджером соединений</param>
    private sealed class GatedClients(GatedHubContext context) : IHubClients
    {
        /// <summary>
        /// Не поддерживается
        /// </summary>
        public IClientProxy All => throw Unsupported();

        /// <summary>
        /// Прокси одного соединения
        /// </summary>
        /// <param name="connectionId">Идентификатор соединения SignalR</param>
        /// <returns>Прокси, отправка через которое проходит задержку теста</returns>
        public ISingleClientProxy Client(string connectionId) => new GatedProxy(context, connectionId);

        /// <summary>
        /// Прокси одного соединения (интерфейс без <see cref="ISingleClientProxy"/>)
        /// </summary>
        /// <param name="connectionId">Идентификатор соединения SignalR</param>
        /// <returns>Прокси соединения</returns>
        IClientProxy IHubClients<IClientProxy>.Client(string connectionId) => Client(connectionId);

        /// <summary>
        /// Не поддерживается
        /// </summary>
        /// <param name="excludedConnectionIds">Не используется</param>
        /// <returns>Не возвращает</returns>
        public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => throw Unsupported();

        /// <summary>
        /// Не поддерживается
        /// </summary>
        /// <param name="connectionIds">Не используется</param>
        /// <returns>Не возвращает</returns>
        public IClientProxy Clients(IReadOnlyList<string> connectionIds) => throw Unsupported();

        /// <summary>
        /// Не поддерживается
        /// </summary>
        /// <param name="groupName">Не используется</param>
        /// <returns>Не возвращает</returns>
        public IClientProxy Group(string groupName) => throw Unsupported();

        /// <summary>
        /// Не поддерживается
        /// </summary>
        /// <param name="groupName">Не используется</param>
        /// <param name="excludedConnectionIds">Не используется</param>
        /// <returns>Не возвращает</returns>
        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => throw Unsupported();

        /// <summary>
        /// Не поддерживается
        /// </summary>
        /// <param name="groupNames">Не используется</param>
        /// <returns>Не возвращает</returns>
        public IClientProxy Groups(IReadOnlyList<string> groupNames) => throw Unsupported();

        /// <summary>
        /// Не поддерживается
        /// </summary>
        /// <param name="userId">Не используется</param>
        /// <returns>Не возвращает</returns>
        public IClientProxy User(string userId) => throw Unsupported();

        /// <summary>
        /// Не поддерживается
        /// </summary>
        /// <param name="userIds">Не используется</param>
        /// <returns>Не возвращает</returns>
        public IClientProxy Users(IReadOnlyList<string> userIds) => throw Unsupported();

        /// <summary>
        /// Ошибка для неподдерживаемой адресации
        /// </summary>
        /// <returns>Исключение</returns>
        private static NotSupportedException Unsupported() =>
            new("В тестовом контексте хаба поддерживается только отправка одному соединению.");
    }

    /// <summary>
    /// Прокси одного соединения: задержка теста, затем настоящая отправка
    /// </summary>
    /// <param name="context">Контекст с задержкой теста и менеджером соединений</param>
    /// <param name="connectionId">Идентификатор соединения SignalR</param>
    private sealed class GatedProxy(GatedHubContext context, string connectionId) : ISingleClientProxy
    {
        /// <summary>
        /// Отправляет сообщение после задержки теста
        /// </summary>
        /// <param name="method">Имя сообщения</param>
        /// <param name="args">Аргументы</param>
        /// <param name="cancellationToken">Отмена отправки</param>
        /// <returns>Задача отправки</returns>
        public async Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
        {
            await context.BeforeSend(connectionId, method);
            await context._lifetime.SendConnectionAsync(connectionId, method, args, cancellationToken);
        }

        /// <summary>
        /// Не поддерживается: диспетчер не вызывает методы клиента с результатом
        /// </summary>
        /// <typeparam name="T">Тип результата</typeparam>
        /// <param name="method">Не используется</param>
        /// <param name="args">Не используется</param>
        /// <param name="cancellationToken">Не используется</param>
        /// <returns>Не возвращает</returns>
        public Task<T> InvokeCoreAsync<T>(string method, object?[] args, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Вызов клиента с результатом в тестах не поддерживается.");
    }
}
