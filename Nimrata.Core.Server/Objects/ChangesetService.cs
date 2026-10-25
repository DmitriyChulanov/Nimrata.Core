using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Objects;

/// <summary>Набор изменений отклонён; <see cref="Message"/> пригоден для показа пользователю.</summary>
public sealed class ChangesetRejectedException(string message, bool conflict = false) : Exception(message)
{
    /// <summary>Отказ из-за расхождения с текущими данными (клиенту стоит перезагрузить объекты).</summary>
    public bool Conflict { get; } = conflict;
}

/// <summary>Применение набора изменений: одна транзакция, проверки по типам, запись в журнал.</summary>
public sealed class ChangesetService(NpgsqlDataSource данные)
{
    private sealed record СтрокаТипа(string Id, JsonElement Definition);

    /// <summary>Применяет набор целиком или отклоняет его; возвращает идентификатор записи журнала.</summary>
    public async Task<Guid> Применить(Guid пользователь, JsonElement тело)
    {
        if (тело.ValueKind != JsonValueKind.Object
            || !тело.TryGetProperty("operations", out var операции)
            || операции.ValueKind != JsonValueKind.Array
            || операции.GetArrayLength() == 0)
        {
            throw new ChangesetRejectedException("Набор изменений должен содержать непустой список операций (operations).");
        }

        await using var соединение = await данные.OpenConnectionAsync();
        await using var транзакция = await соединение.BeginTransactionAsync();

        var типы = (await соединение.QueryAsync<СтрокаТипа>(
                "select id as Id, definition as Definition from types", transaction: транзакция))
            .ToDictionary(т => т.Id, т => new ОписаниеТипа(т.Id, т.Definition));

        var набор = await соединение.ExecuteScalarAsync<Guid>(
            "insert into changesets (user_id) values (@пользователь) returning id", new { пользователь }, транзакция);

        var контекст = new Контекст(соединение, транзакция, пользователь, набор, типы);
        var номер = 0;
        foreach (var операция in операции.EnumerateArray())
        {
            контекст.Номер = ++номер;
            try
            {
                await Выполнить(контекст, операция);
            }
            catch (ChangesetRejectedException отказ)
            {
                throw new ChangesetRejectedException($"Операция {номер}: {отказ.Message}", отказ.Conflict);
            }
            catch (Exception ошибка) when (ошибка is InvalidOperationException or FormatException or KeyNotFoundException)
            {
                throw new ChangesetRejectedException($"Операция {номер}: неверный формат ({ошибка.Message}).");
            }
        }

        await транзакция.CommitAsync();
        return набор;
    }

    private static async Task Выполнить(Контекст к, JsonElement операция)
    {
        var вид = операция.ValueKind == JsonValueKind.Object && операция.TryGetProperty("op", out var о)
            && о.ValueKind == JsonValueKind.String ? о.GetString() : null;
        switch (вид)
        {
            case "create":
                await Создать(к, операция);
                break;
            default:
                throw new ChangesetRejectedException($"неизвестный вид операции \"{вид}\".");
        }
    }

    private static async Task Создать(Контекст к, JsonElement операция)
    {
        var id = Идентификатор(операция, "id") ?? throw new ChangesetRejectedException("не указан идентификатор объекта (id).");
        var имяТипа = операция.TryGetProperty("type", out var т) && т.ValueKind == JsonValueKind.String ? т.GetString()! : "";
        if (!к.Типы.TryGetValue(имяТипа, out var тип))
        {
            throw new ChangesetRejectedException($"тип \"{имяТипа}\" неизвестен.");
        }
        if (тип.Абстрактный)
        {
            throw new ChangesetRejectedException($"тип \"{имяТипа}\" абстрактный, создавать объекты такого типа нельзя.");
        }

        if (await к.Соединение.ExecuteScalarAsync<bool>(
                "select exists (select 1 from objects where id = @id)", new { id }, к.Транзакция))
        {
            throw new ChangesetRejectedException($"идентификатор {id} уже занят.", conflict: true);
        }

        var родитель = Идентификатор(операция, "parent");
        if (родитель is not null)
        {
            var строка = await ПрочитатьОбъект(к, родитель.Value)
                ?? throw new ChangesetRejectedException($"родитель {родитель} не найден.");
            ПроверитьДопустимостьРодителя(к, имяТипа, строка.Type);
        }

        var порядок = операция.TryGetProperty("order", out var п) && п.ValueKind == JsonValueKind.Number ? п.GetDouble() : 0;
        var свойства = new JsonObject();
        if (операция.TryGetProperty("properties", out var св))
        {
            if (св.ValueKind != JsonValueKind.Object)
            {
                throw new ChangesetRejectedException("properties должны быть объектом.");
            }
            foreach (var свойство in св.EnumerateObject())
            {
                await ПроверитьЗначение(к, тип, свойство.Name, свойство.Value);
                if (свойство.Value.ValueKind != JsonValueKind.Null)
                {
                    свойства[свойство.Name] = JsonNode.Parse(свойство.Value.GetRawText());
                }
            }
        }

        await к.Соединение.ExecuteAsync(
            """
            insert into objects (id, type_id, parent_id, owner_id, sort_order, properties)
            values (@id, @имяТипа, @родитель, @пользователь, @порядок, @свойства)
            """,
            new { id, имяТипа, родитель, к.Пользователь, порядок, свойства = ВJson(свойства) }, к.Транзакция);

        var новое = new JsonObject
        {
            ["type"] = имяТипа, ["parent"] = родитель, ["order"] = порядок, ["properties"] = свойства.DeepClone(),
        };
        await ЗаписатьВЖурнал(к, id, "create", null, null, новое, null);
    }

    private sealed record СтрокаОбъекта(Guid Id, string Type, Guid? Parent, double Order, JsonElement Properties);

    /// <summary>Читает объект текущего пользователя с блокировкой; чужой и несуществующий неразличимы.</summary>
    private static Task<СтрокаОбъекта?> ПрочитатьОбъект(Контекст к, Guid id) =>
        к.Соединение.QuerySingleOrDefaultAsync<СтрокаОбъекта>(
            """
            select id as Id, type_id as Type, parent_id as Parent, sort_order as "Order", properties as Properties
            from objects where id = @id and owner_id = @пользователь for update
            """, new { id, пользователь = к.Пользователь }, к.Транзакция);

    private static void ПроверитьДопустимостьРодителя(Контекст к, string типРебёнка, string типРодителя)
    {
        var родитель = к.Типы[типРодителя];
        if (родитель.ДопустимыеДети is { } дети && !дети.Contains(типРебёнка))
        {
            throw new ChangesetRejectedException(
                $"тип \"{типРебёнка}\" нельзя разместить внутри типа \"{типРодителя}\".");
        }
    }

    private static async Task ПроверитьЗначение(Контекст к, ОписаниеТипа тип, string свойство, JsonElement значение)
    {
        if (!тип.Свойства.TryGetValue(свойство, out var описание))
        {
            throw new ChangesetRejectedException($"у типа \"{тип.Id}\" нет свойства \"{свойство}\".");
        }
        if (значение.ValueKind == JsonValueKind.Null)
        {
            return;
        }

        var верно = описание.Вид switch
        {
            "string" or "text" => значение.ValueKind == JsonValueKind.String,
            "integer" => значение.ValueKind == JsonValueKind.Number && значение.TryGetInt64(out _),
            "boolean" => значение.ValueKind is JsonValueKind.True or JsonValueKind.False,
            "date" => значение.ValueKind == JsonValueKind.String
                && DateOnly.TryParseExact(значение.GetString(), "yyyy-MM-dd", out _),
            "time" => значение.ValueKind == JsonValueKind.String
                && TimeOnly.TryParseExact(значение.GetString(), "HH:mm", out _),
            "enum" => значение.ValueKind == JsonValueKind.String && описание.Значения!.Contains(значение.GetString()!),
            "reference" => значение.ValueKind == JsonValueKind.String && значение.TryGetGuid(out _),
            _ => false,
        };
        if (!верно)
        {
            throw new ChangesetRejectedException(
                $"значение свойства \"{свойство}\" не подходит под вид \"{описание.Вид}\"" +
                (описание.Вид == "enum" ? $" (допустимо: {string.Join(", ", описание.Значения!)})." : "."));
        }

        if (описание.Вид == "reference")
        {
            var цель = await ПрочитатьОбъект(к, значение.GetGuid());
            if (цель is null)
            {
                throw new ChangesetRejectedException($"свойство \"{свойство}\" ссылается на несуществующий объект.");
            }
            if (описание.ЦелевыеТипы is { } цели && !цели.Contains(цель.Type))
            {
                throw new ChangesetRejectedException(
                    $"свойство \"{свойство}\" не может ссылаться на объект типа \"{цель.Type}\".");
            }
        }
    }

    private static Guid? Идентификатор(JsonElement операция, string имя) =>
        операция.TryGetProperty(имя, out var з) && з.ValueKind == JsonValueKind.String && з.TryGetGuid(out var id) ? id : null;

    private static Task ЗаписатьВЖурнал(Контекст к, Guid объект, string операция, string? свойство,
        JsonNode? было, JsonNode? стало, JsonNode? снимок) =>
        к.Соединение.ExecuteAsync(
            """
            insert into changeset_entries (changeset_id, seq, object_id, operation, property, old_value, new_value, snapshot)
            values (@набор, @номер, @объект, @операция, @свойство, @было, @стало, @снимок)
            """,
            new
            {
                набор = к.Набор, номер = к.Номер, объект, операция, свойство,
                было = ВJson(было), стало = ВJson(стало), снимок = ВJson(снимок),
            }, к.Транзакция);

    private static JsonElement? ВJson(JsonNode? узел) =>
        узел is null ? null : JsonSerializer.Deserialize<JsonElement>(узел.ToJsonString());

    private sealed class Контекст(NpgsqlConnection соединение, NpgsqlTransaction транзакция, Guid пользователь,
        Guid набор, Dictionary<string, ОписаниеТипа> типы)
    {
        public NpgsqlConnection Соединение { get; } = соединение;
        public NpgsqlTransaction Транзакция { get; } = транзакция;
        public Guid Пользователь { get; } = пользователь;
        public Guid Набор { get; } = набор;
        public Dictionary<string, ОписаниеТипа> Типы { get; } = типы;
        public int Номер { get; set; }
    }

    private sealed record ОписаниеСвойства(string Вид, HashSet<string>? Значения, HashSet<string>? ЦелевыеТипы);

    private sealed class ОписаниеТипа
    {
        public string Id { get; }
        public bool Абстрактный { get; }
        /// <summary>null: ограничений нет (список allowedChildren в манифесте не задан).</summary>
        public HashSet<string>? ДопустимыеДети { get; }
        public Dictionary<string, ОписаниеСвойства> Свойства { get; } = [];

        public ОписаниеТипа(string id, JsonElement определение)
        {
            Id = id;
            Абстрактный = определение.TryGetProperty("abstract", out var а) && а.ValueKind == JsonValueKind.True;
            if (определение.TryGetProperty("allowedChildren", out var дети) && дети.ValueKind == JsonValueKind.Array)
            {
                ДопустимыеДети = дети.EnumerateArray().Select(д => д.GetString()!).ToHashSet();
            }
            if (определение.TryGetProperty("properties", out var свойства) && свойства.ValueKind == JsonValueKind.Array)
            {
                foreach (var с in свойства.EnumerateArray())
                {
                    HashSet<string>? значения = с.TryGetProperty("values", out var з)
                        ? з.EnumerateArray().Select(x => x.GetProperty("value").GetString()!).ToHashSet() : null;
                    HashSet<string>? цели = с.TryGetProperty("targetTypes", out var ц)
                        ? ц.EnumerateArray().Select(x => x.GetString()!).ToHashSet() : null;
                    Свойства[с.GetProperty("id").GetString()!] = new(с.GetProperty("kind").GetString()!, значения, цели);
                }
            }
        }
    }
}
