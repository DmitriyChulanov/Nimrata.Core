using System.Text.Json.Nodes;
using Nimrata.Core.Server.Objects;

namespace Nimrata.Core.Server.Sync;

/// <summary>
/// Согласованная полная загрузка <c>GET /api/snapshot</c>: типы, объекты и курсор, прочитанные в одном снимке БД
/// </summary>
/// <param name="Seq">Курсор снимка: <c>seq</c> последнего набора пользователя (0 — наборов нет); с него начинается догон</param>
/// <param name="Types">Определения всех типов, как в <c>GET /api/types</c></param>
/// <param name="Objects">Видимые объекты пользователя, как в <c>GET /api/objects</c></param>
public sealed record SyncSnapshot(long Seq, IReadOnlyList<JsonObject> Types, IReadOnlyList<ObjectRecord> Objects);
