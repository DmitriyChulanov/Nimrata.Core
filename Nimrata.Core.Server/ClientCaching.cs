using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;

namespace Nimrata.Core.Server;

/// <summary>
/// Заголовки кэширования собранного клиента из wwwroot: service worker, его регистрация и оболочка
/// <c>index.html</c> проверяются у сервера при каждом запросе (иначе новая версия не подхватится),
/// ассеты с хэшем в имени кэшируются надолго
/// </summary>
public static class ClientCaching
{
    /// <summary>
    /// Значение Cache-Control для файлов, которые нужно проверять у сервера каждый раз
    /// </summary>
    public const string Revalidate = "no-cache";

    /// <summary>
    /// Значение Cache-Control для ассетов с хэшем в имени: содержимое под тем же именем не меняется
    /// </summary>
    public const string Immutable = "public, max-age=31536000, immutable";

    /// <summary>
    /// Имена файлов, которые всегда проверяются у сервера
    /// </summary>
    private static readonly HashSet<string> RevalidatedFiles = new(StringComparer.OrdinalIgnoreCase)
    {
        "sw.js",
        "registerSW.js",
        "index.html",
    };

    /// <summary>
    /// Создаёт настройки раздачи статики с заголовками кэширования клиента
    /// </summary>
    /// <returns>Настройки для <c>UseStaticFiles</c> и <c>MapFallbackToFile</c></returns>
    public static StaticFileOptions CreateStaticFileOptions() => new() { OnPrepareResponse = Apply };

    /// <summary>
    /// Выставляет Cache-Control отдаваемому файлу по его пути в wwwroot
    /// </summary>
    /// <param name="context">Контекст отдачи файла: путь берётся из <see cref="StaticFileResponseContext.File"/>,
    /// так что и SPA-fallback получает заголовки <c>index.html</c></param>
    private static void Apply(StaticFileResponseContext context)
    {
        var headers = context.Context.Response.Headers;
        if (context.Context.Request.Path.StartsWithSegments("/assets"))
        {
            headers[HeaderNames.CacheControl] = Immutable;
        }
        else if (RevalidatedFiles.Contains(context.File.Name))
        {
            headers[HeaderNames.CacheControl] = Revalidate;
        }
    }
}
