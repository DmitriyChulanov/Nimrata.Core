namespace Nimrata.Core.Server.Sync;

/// <summary>
/// Уведомления для push: что у пользователя появились изменения, которые надо разослать его клиентам.
/// Источник истины — журнал в БД; уведомление только помечает пользователя «грязным»
/// </summary>
public interface IChangeNotifier
{
    /// <summary>
    /// Набор пользователя зафиксирован (вызывается после коммита транзакции)
    /// </summary>
    /// <param name="userId">Автор набора</param>
    /// <param name="seq">Курсор зафиксированного набора</param>
    void Changed(Guid userId, long seq);

    /// <summary>
    /// Клиентам пользователя нужно перечитать данные целиком (например, подключено или отключено расширение)
    /// </summary>
    /// <param name="userId">Пользователь, чьи клиенты получают <c>resync</c></param>
    void Resync(Guid userId);
}
