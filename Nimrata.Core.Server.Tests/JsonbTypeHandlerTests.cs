using System.Text.Json;
using Nimrata.Core.Server.Data;
using Npgsql;
using NpgsqlTypes;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Обработчик jsonb для Dapper
/// </summary>
public class JsonbTypeHandlerTests
{
    /// <summary>
    /// Проверяет, что значение записывается в параметр с типом jsonb
    /// </summary>
    [Fact]
    public void SetValue_WritesParameterAsJsonb()
    {
        using var document = JsonDocument.Parse("""{"a":1}""");
        var parameter = new NpgsqlParameter();

        new JsonbTypeHandler().SetValue(parameter, document.RootElement);

        Assert.Equal(NpgsqlDbType.Jsonb, parameter.NpgsqlDbType);
        Assert.Equal("""{"a":1}""", parameter.Value);
    }

    /// <summary>
    /// Проверяет, что строка jsonb разбирается в JsonElement
    /// </summary>
    [Fact]
    public void Parse_JsonbString_ReturnsJsonElement()
    {
        var value = new JsonbTypeHandler().Parse("""{"имя":"Задача","теги":[1,2]}""");

        Assert.Equal("Задача", value.GetProperty("имя").GetString());
        Assert.Equal(2, value.GetProperty("теги").GetArrayLength());
    }
}
