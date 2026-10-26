namespace Nimrata.Core.Server.Extensions;

/// <summary>
/// Расширение в каталоге: метаданные манифеста и состояние подключения пользователя
/// </summary>
/// <param name="Id">Идентификатор расширения</param>
/// <param name="Name">Название</param>
/// <param name="Description">Описание</param>
/// <param name="Icon">Имя иконки в реестре иконок клиента</param>
/// <param name="DefaultEnabled">Состояние, пока у пользователя нет записи подключения</param>
/// <param name="Connected">Подключено ли расширение пользователю</param>
public sealed record ExtensionInfo(
    string Id, string Name, string Description, string Icon, bool DefaultEnabled, bool Connected);
