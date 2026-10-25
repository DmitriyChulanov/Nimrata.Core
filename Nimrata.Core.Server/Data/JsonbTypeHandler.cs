using System.Data;
using System.Text.Json;
using Dapper;
using Npgsql;
using NpgsqlTypes;

namespace Nimrata.Core.Server.Data;

/// <summary>Обработчик Dapper: колонки jsonb отображаются в <see cref="JsonElement"/>.</summary>
public sealed class JsonbTypeHandler : SqlMapper.TypeHandler<JsonElement>
{
    public override void SetValue(IDbDataParameter parameter, JsonElement value)
    {
        parameter.Value = value.GetRawText();
        if (parameter is NpgsqlParameter npgsql)
        {
            npgsql.NpgsqlDbType = NpgsqlDbType.Jsonb;
        }
    }

    public override JsonElement Parse(object value)
    {
        using var документ = JsonDocument.Parse(value.ToString()!);
        return документ.RootElement.Clone();
    }
}
