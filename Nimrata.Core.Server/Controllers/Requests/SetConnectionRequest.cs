using System.ComponentModel.DataAnnotations;

namespace Nimrata.Core.Server.Controllers.Requests;

/// <summary>
/// Новое состояние подключения расширения
/// </summary>
/// <param name="Connected">Подключить (<c>true</c>) или отключить расширение; обязательное поле</param>
public sealed record SetConnectionRequest([Required] bool? Connected);
