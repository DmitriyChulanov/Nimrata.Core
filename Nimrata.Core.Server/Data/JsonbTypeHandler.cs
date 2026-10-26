using System.Data;
using System.Text.Json;
using Dapper;
using Npgsql;
using NpgsqlTypes;

namespace Nimrata.Core.Server.Data;

/// <summary>
/// Обработчик Dapper: колонки jsonb отображаются в <see cref="JsonElement"/>
/// </summary>
public sealed class JsonbTypeHandler : SqlMapper.TypeHandler<JsonElement>
{
    /// <summary>
    /// Записывает значение в параметр запроса как jsonb
    /// </summary>
    /// <param name="parameter">Параметр команды</param>
    /// <param name="value">Записываемый JSON</param>
    public override void SetValue(IDbDataParameter parameter, JsonElement value)
    {
        parameter.Value = value.GetRawText();
        if (parameter is NpgsqlParameter npgsql)
        {
            npgsql.NpgsqlDbType = NpgsqlDbType.Jsonb;
        }
    }

    /// <summary>
    /// Разбирает значение колонки jsonb
    /// </summary>
    /// <param name="value">Значение, пришедшее из БД</param>
    /// <returns>Независимая копия корневого элемента JSON</returns>
    public override JsonElement Parse(object value)
    {
        using var document = JsonDocument.Parse(value.ToString()!);
        return document.RootElement.Clone();
    }
}
