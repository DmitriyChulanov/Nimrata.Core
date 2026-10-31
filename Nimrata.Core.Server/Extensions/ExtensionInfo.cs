using System.Text.Json;

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
/// <param name="Commands">Команды расширения из манифеста (JSON-массив; пустой, если команд нет)</param>
/// <param name="Version">Версия типов расширения в БД (0, если типов нет): клиент с кэшем по ней узнаёт, что типы устарели</param>
public sealed record ExtensionInfo(
    string Id, string Name, string Description, string Icon, bool DefaultEnabled, bool Connected, JsonElement Commands, int Version);
