using System.Text.Json;

namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Объект пользователя в том виде, в каком он отдаётся клиенту
/// </summary>
public sealed record ObjectRecord(Guid Id, string Type, Guid? Parent, double Order, JsonElement Properties);
