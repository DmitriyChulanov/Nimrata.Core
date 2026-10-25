using System.Text.Json;
using Nimrata.Core.Server.Data;
using Npgsql;
using NpgsqlTypes;

namespace Nimrata.Core.Server.Tests;

public class JsonbTypeHandlerTests
{
    [Fact]
    public void SetValue_ПишетПараметрКакJsonb()
    {
        using var документ = JsonDocument.Parse("""{"a":1}""");
        var параметр = new NpgsqlParameter();

        new JsonbTypeHandler().SetValue(параметр, документ.RootElement);

        Assert.Equal(NpgsqlDbType.Jsonb, параметр.NpgsqlDbType);
        Assert.Equal("""{"a":1}""", параметр.Value);
    }

    [Fact]
    public void Parse_ЧитаетСтрокуJsonbВJsonElement()
    {
        var значение = new JsonbTypeHandler().Parse("""{"имя":"Задача","теги":[1,2]}""");

        Assert.Equal("Задача", значение.GetProperty("имя").GetString());
        Assert.Equal(2, значение.GetProperty("теги").GetArrayLength());
    }
}
