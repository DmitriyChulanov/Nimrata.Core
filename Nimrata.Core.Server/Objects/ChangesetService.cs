using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Npgsql;

namespace Nimrata.Core.Server.Objects;

/// <summary>
/// Применение набора изменений: одна транзакция, проверки по типам, запись в журнал
/// </summary>
public sealed class ChangesetService(NpgsqlDataSource dataSource)
{
    private sealed record TypeRow(string Id, string? ExtensionId, JsonElement Definition);

    /// <summary>
    /// Применяет набор целиком или отклоняет его
    /// </summary>
    /// <param name="userId">Владелец объектов и автор записей журнала</param>
    /// <param name="body">Набор в формате клиента: объект с непустым массивом <c>operations</c></param>
    /// <param name="cancellationToken">Отмена применения</param>
    /// <returns>Идентификатор набора в журнале</returns>
    /// <exception cref="ChangesetRejectedException">Набор невалиден или расходится с текущими данными</exception>
    public async Task<Guid> ApplyAsync(Guid userId, JsonElement body, CancellationToken cancellationToken = default)
    {
        if (body.ValueKind != JsonValueKind.Object
            || !body.TryGetProperty("operations", out var operations)
            || operations.ValueKind != JsonValueKind.Array
            || operations.GetArrayLength() == 0)
        {
            throw new ChangesetRejectedException("Набор изменений должен содержать непустой список операций (operations).");
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var typeRows = await connection.QueryAsync<TypeRow>(new CommandDefinition(
            "select id as Id, extension_id as ExtensionId, definition as Definition from types",
            transaction: transaction,
            cancellationToken: cancellationToken));
        var types = typeRows.ToDictionary(row => row.Id, row => new TypeDescriptor(row.Id, row.ExtensionId, row.Definition));

        var disabledExtensions = (await connection.QueryAsync<string>(new CommandDefinition(
            "select id from extensions where not is_extension_enabled(@userId, id)",
            new { userId },
            transaction,
            cancellationToken: cancellationToken))).ToHashSet();

        var changesetId = await connection.ExecuteScalarAsync<Guid>(new CommandDefinition(
            "insert into changesets (user_id) values (@userId) returning id",
            new { userId },
            transaction,
            cancellationToken: cancellationToken));

        var context = new ChangesetContext(connection, transaction, userId, changesetId, types, disabledExtensions, cancellationToken);
        var number = 0;
        foreach (var operation in operations.EnumerateArray())
        {
            number++;
            try
            {
                await ExecuteAsync(context, operation);
            }
            catch (ChangesetRejectedException rejection)
            {
                throw new ChangesetRejectedException($"Операция {number}: {rejection.Message}", rejection.Conflict, rejection.Code);
            }
            catch (Exception exception) when (exception is InvalidOperationException or FormatException or KeyNotFoundException)
            {
                throw new ChangesetRejectedException($"Операция {number}: неверный формат ({exception.Message}).");
            }
        }

        await transaction.CommitAsync(cancellationToken);
        return changesetId;
    }

    private static async Task ExecuteAsync(ChangesetContext context, JsonElement operation)
    {
        var kind = operation.ValueKind == JsonValueKind.Object
            && operation.TryGetProperty("op", out var op)
            && op.ValueKind == JsonValueKind.String
                ? op.GetString()
                : null;
        switch (kind)
        {
            case "create":
                await CreateAsync(context, operation);
                break;
            case "update":
                await UpdateAsync(context, operation);
                break;
            case "move":
                await MoveAsync(context, operation);
                break;
            case "delete":
                await DeleteAsync(context, operation);
                break;
            default:
                throw new ChangesetRejectedException($"неизвестный вид операции \"{kind}\".");
        }
    }

    private static async Task CreateAsync(ChangesetContext context, JsonElement operation)
    {
        var id = ReadGuid(operation, "id") ?? throw new ChangesetRejectedException("не указан идентификатор объекта (id).");
        var typeName = operation.TryGetProperty("type", out var typeElement) && typeElement.ValueKind == JsonValueKind.String
            ? typeElement.GetString() ?? ""
            : "";
        if (!context.Types.TryGetValue(typeName, out var type))
        {
            throw new ChangesetRejectedException($"тип \"{typeName}\" неизвестен.");
        }
        if (type.IsAbstract)
        {
            throw new ChangesetRejectedException($"тип \"{typeName}\" абстрактный, создавать объекты такого типа нельзя.");
        }
        EnsureEnabled(context, type);

        if (await context.ScalarAsync<bool>("select exists (select 1 from objects where id = @id)", new { id }))
        {
            throw new ChangesetRejectedException($"идентификатор {id} уже занят.", conflict: true);
        }

        var parent = ReadGuid(operation, "parent");
        if (parent is not null)
        {
            var parentRow = await ReadOwnObjectAsync(context, parent.Value)
                ?? throw new ChangesetRejectedException($"родитель {parent} не найден.");
            EnsureEnabled(context, context.Types[parentRow.Type]);
            EnsureParentAllowsChild(context, typeName, parentRow.Type);
        }

        if (type.IsSingleton)
        {
            await EnsureSingletonAsync(context, type, parent);
        }

        var number = operation.TryGetProperty("number", out var numberElement)
            ? ReadNumber(numberElement, "number")
            : 1;
        var properties = new JsonObject();
        if (operation.TryGetProperty("properties", out var propertiesElement))
        {
            if (propertiesElement.ValueKind != JsonValueKind.Object)
            {
                throw new ChangesetRejectedException("properties должны быть объектом.");
            }
            foreach (var property in propertiesElement.EnumerateObject())
            {
                await ValidateValueAsync(context, type, property.Name, property.Value);
                if (property.Value.ValueKind != JsonValueKind.Null)
                {
                    properties[property.Name] = JsonNode.Parse(property.Value.GetRawText());
                }
            }
        }

        await context.ExecuteAsync(
            """
            insert into objects (id, type_id, parent_id, owner_id, number, properties)
            values (@id, @typeName, @parent, @userId, @number, @properties)
            """,
            new { id, typeName, parent, context.UserId, number, properties = ToJsonElement(properties) });

        var created = new JsonObject
        {
            ["type"] = typeName,
            ["parent"] = parent,
            ["number"] = number,
            ["properties"] = properties.DeepClone(),
        };
        await WriteJournalAsync(context, id, typeName, "create", property: null, old: null, @new: created, snapshot: null);
    }

    private static async Task UpdateAsync(ChangesetContext context, JsonElement operation)
    {
        var target = await ReadTargetAsync(context, operation);
        if (!operation.TryGetProperty("changes", out var changes)
            || changes.ValueKind != JsonValueKind.Object
            || !changes.EnumerateObject().Any())
        {
            throw new ChangesetRejectedException("не указаны изменения свойств (changes).");
        }

        var type = context.Types[target.Type];
        var properties = JsonNode.Parse(target.Properties.GetRawText())?.AsObject() ?? new JsonObject();
        foreach (var change in changes.EnumerateObject())
        {
            var name = change.Name;
            if (change.Value.ValueKind != JsonValueKind.Object
                || !change.Value.TryGetProperty("old", out var expectedOld)
                || !change.Value.TryGetProperty("new", out var newValue))
            {
                throw new ChangesetRejectedException($"для свойства \"{name}\" нужны значения old (было) и new (стало).");
            }
            await ValidateValueAsync(context, type, name, newValue);

            var current = properties.TryGetPropertyValue(name, out var currentNode) && currentNode is not null
                ? JsonSerializer.Deserialize<JsonElement>(currentNode.ToJsonString())
                : default;
            if (!ValuesEqual(current, expectedOld))
            {
                throw new ChangesetRejectedException(
                    $"свойство \"{name}\" изменилось с момента загрузки (значение «было» не совпало с текущим). Обновите данные.",
                    conflict: true);
            }

            if (newValue.ValueKind == JsonValueKind.Null)
            {
                properties.Remove(name);
            }
            else
            {
                properties[name] = JsonNode.Parse(newValue.GetRawText());
            }
            await WriteJournalAsync(
                context, target.Id, target.Type, "update", name,
                old: current.ValueKind == JsonValueKind.Undefined ? null : JsonNode.Parse(current.GetRawText()),
                @new: newValue.ValueKind == JsonValueKind.Null ? null : JsonNode.Parse(newValue.GetRawText()),
                snapshot: null);
        }

        await context.ExecuteAsync(
            "update objects set properties = @properties where id = @id",
            new { id = target.Id, properties = ToJsonElement(properties) });
    }

    private static async Task MoveAsync(ChangesetContext context, JsonElement operation)
    {
        var target = await ReadTargetAsync(context, operation);
        var changesParent = operation.TryGetProperty("parent", out var parentChange)
            && parentChange.ValueKind == JsonValueKind.Object;
        var changesNumber = operation.TryGetProperty("number", out var numberChange)
            && numberChange.ValueKind == JsonValueKind.Object;
        if (!changesParent && !changesNumber)
        {
            throw new ChangesetRejectedException("перемещение должно менять parent или number.");
        }

        var parent = target.Parent;
        var number = target.Number;
        if (changesParent)
        {
            parent = await ReadNewParentAsync(context, target, parentChange);
            if (context.Types[target.Type].IsSingleton)
            {
                await EnsureSingletonAsync(context, context.Types[target.Type], parent, target.Id);
            }
        }
        if (changesNumber)
        {
            number = ReadNewNumber(target, numberChange);
        }

        await context.ExecuteAsync(
            "update objects set parent_id = @parent, number = @number where id = @id",
            new { id = target.Id, parent, number });
        await WriteJournalAsync(
            context, target.Id, target.Type, "move", property: null,
            old: new JsonObject { ["parent"] = target.Parent, ["number"] = target.Number },
            @new: new JsonObject { ["parent"] = parent, ["number"] = number },
            snapshot: null);
    }

    /// <summary>
    /// Проверяет «было» для parent и возвращает нового родителя (<c>null</c> — корень)
    /// </summary>
    private static async Task<Guid?> ReadNewParentAsync(ChangesetContext context, ObjectRecord target, JsonElement change)
    {
        if (!change.TryGetProperty("old", out var expectedOld) || !change.TryGetProperty("new", out var newValue))
        {
            throw new ChangesetRejectedException("для parent нужны значения old (было) и new (стало).");
        }
        var currentParent = target.Parent is { } current ? GuidToJson(current) : default;
        if (!ValuesEqual(currentParent, expectedOld))
        {
            throw new ChangesetRejectedException(
                "родитель (parent) изменился с момента загрузки (значение «было» не совпало с текущим). Обновите данные.",
                conflict: true);
        }
        if (newValue.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        var parent = ReadGuid(change, "new")
            ?? throw new ChangesetRejectedException("parent.new должен быть идентификатором или null.");
        if (parent == target.Id || await IsAncestorAsync(context, parent, target.Id))
        {
            throw new ChangesetRejectedException("нельзя переместить объект в самого себя или в своего потомка (получится цикл).");
        }
        var parentRow = await ReadOwnObjectAsync(context, parent)
            ?? throw new ChangesetRejectedException($"родитель {parent} не найден.");
        EnsureEnabled(context, context.Types[parentRow.Type]);
        EnsureParentAllowsChild(context, target.Type, parentRow.Type);
        return parent;
    }

    /// <summary>
    /// Проверяет «было» для number и возвращает новый номер
    /// </summary>
    private static int ReadNewNumber(ObjectRecord target, JsonElement change)
    {
        if (!change.TryGetProperty("old", out var expectedOld) || !change.TryGetProperty("new", out var newValue))
        {
            throw new ChangesetRejectedException("для number нужны значения old (было) и new (стало, целое ≥ 1).");
        }
        var number = ReadNumber(newValue, "number.new");
        if (expectedOld.ValueKind != JsonValueKind.Number
            || !expectedOld.TryGetInt32(out var currentNumber)
            || currentNumber != target.Number)
        {
            throw new ChangesetRejectedException(
                "номер (number) изменился с момента загрузки (значение «было» не совпало с текущим). Обновите данные.",
                conflict: true);
        }
        return number;
    }

    /// <summary>
    /// «Номер» — целое число не меньше 1
    /// </summary>
    private static int ReadNumber(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out var number) || number < 1)
        {
            throw new ChangesetRejectedException($"{name} должен быть целым числом не меньше 1.");
        }
        return number;
    }

    private static async Task DeleteAsync(ChangesetContext context, JsonElement operation)
    {
        var target = await ReadTargetAsync(context, operation);
        var childCount = await context.ScalarAsync<long>(
            "select count(*) from objects where parent_id = @id", new { id = target.Id });
        if (childCount > 0)
        {
            throw new ChangesetRejectedException(
                $"у объекта {target.Id} остались потомки ({childCount}): перечислите в наборе все удаляемые объекты, потомков раньше родителей.");
        }

        var snapshot = new JsonObject
        {
            ["type"] = target.Type,
            ["parent"] = target.Parent,
            ["number"] = target.Number,
            ["properties"] = JsonNode.Parse(target.Properties.GetRawText()),
        };
        await context.ExecuteAsync("delete from objects where id = @id", new { id = target.Id });
        await WriteJournalAsync(context, target.Id, target.Type, "delete", property: null, old: null, @new: null, snapshot);
    }

    /// <summary>
    /// Объект, на который указывает операция; чужой и несуществующий неразличимы
    /// </summary>
    private static async Task<ObjectRecord> ReadTargetAsync(ChangesetContext context, JsonElement operation)
    {
        var id = ReadGuid(operation, "id") ?? throw new ChangesetRejectedException("не указан идентификатор объекта (id).");
        var target = await ReadOwnObjectAsync(context, id)
            ?? throw new ChangesetRejectedException($"объект {id} не найден.");
        EnsureEnabled(context, context.Types[target.Type]);
        return target;
    }

    /// <summary>
    /// Запись в объекты типа отключённого расширения отклоняется
    /// </summary>
    private static void EnsureEnabled(ChangesetContext context, TypeDescriptor type)
    {
        if (type.ExtensionId is { } extensionId && context.DisabledExtensions.Contains(extensionId))
        {
            throw new ChangesetRejectedException(
                $"Расширение отключено ({extensionId}): тип \"{type.Id}\" недоступен для записи.",
                code: RejectionCodes.ExtensionDisabled);
        }
    }

    /// <summary>
    /// Второй объект типа <c>singleton</c> у того же родителя и владельца отклоняется
    /// </summary>
    /// <param name="context">Контекст применения набора</param>
    /// <param name="type">Тип объекта с признаком <c>singleton</c></param>
    /// <param name="parent">Родитель, под которым объект создаётся или оказывается после перемещения</param>
    /// <param name="excludedId">Перемещаемый объект: он не считается «вторым» самому себе</param>
    private static async Task EnsureSingletonAsync(
        ChangesetContext context, TypeDescriptor type, Guid? parent, Guid? excludedId = null)
    {
        // Блокировка до конца транзакции: два одновременных набора не создадут дубликат
        await context.ExecuteAsync(
            "select pg_advisory_xact_lock(hashtextextended(@key, 0))",
            new { key = $"singleton:{context.UserId}:{type.Id}:{parent}" });
        var exists = await context.ScalarAsync<bool>(
            """
            select exists (
                select 1 from objects
                where owner_id = @userId and type_id = @typeId and parent_id is not distinct from @parent
                  and id is distinct from @excludedId)
            """,
            new { context.UserId, typeId = type.Id, parent, excludedId });
        if (exists)
        {
            throw new ChangesetRejectedException(
                $"объект типа \"{type.Id}\" уже есть у этого родителя, второй создать нельзя.",
                conflict: true,
                code: RejectionCodes.SingletonExists);
        }
    }

    /// <summary>
    /// Читает объект текущего пользователя с блокировкой; чужой и несуществующий неразличимы
    /// </summary>
    private static Task<ObjectRecord?> ReadOwnObjectAsync(ChangesetContext context, Guid id) =>
        context.QueryOneAsync<ObjectRecord>(
            """
            select id as Id, type_id as Type, parent_id as Parent, number as "Number", properties as Properties
            from objects where id = @id and owner_id = @userId for update
            """,
            new { id, context.UserId });

    private static Task<bool> IsAncestorAsync(ChangesetContext context, Guid start, Guid candidate) =>
        context.ScalarAsync<bool>(
            """
            with recursive up as (
                select id, parent_id from objects where id = @start
                union all
                select o.id, o.parent_id from objects o join up on o.id = up.parent_id
            )
            select exists (select 1 from up where id = @candidate)
            """,
            new { start, candidate });

    private static void EnsureParentAllowsChild(ChangesetContext context, string childType, string parentType)
    {
        if (context.Types[parentType].AllowedChildren is { } allowed && !allowed.Contains(childType))
        {
            throw new ChangesetRejectedException(
                $"тип \"{childType}\" нельзя разместить внутри типа \"{parentType}\".");
        }
    }

    private static async Task ValidateValueAsync(
        ChangesetContext context, TypeDescriptor type, string propertyName, JsonElement value)
    {
        if (!type.Properties.TryGetValue(propertyName, out var descriptor))
        {
            throw new ChangesetRejectedException($"у типа \"{type.Id}\" нет свойства \"{propertyName}\".");
        }
        if (value.ValueKind == JsonValueKind.Null)
        {
            return;
        }

        var isValid = descriptor.Kind switch
        {
            "string" or "text" => value.ValueKind == JsonValueKind.String,
            "integer" => value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out _),
            "boolean" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
            "date" => value.ValueKind == JsonValueKind.String
                && DateOnly.TryParseExact(value.GetString(), "yyyy-MM-dd", out _),
            "time" => value.ValueKind == JsonValueKind.String
                && TimeOnly.TryParseExact(value.GetString(), "HH:mm", out _),
            "enum" => value.ValueKind == JsonValueKind.String
                && descriptor.Values is { } values
                && values.Contains(value.GetString() ?? ""),
            "reference" => value.ValueKind == JsonValueKind.String && value.TryGetGuid(out _),
            _ => false,
        };
        if (!isValid)
        {
            var allowedValues = descriptor is { Kind: "enum", Values: { } enumValues }
                ? $" (допустимо: {string.Join(", ", enumValues)})."
                : ".";
            throw new ChangesetRejectedException(
                $"значение свойства \"{propertyName}\" не подходит под вид \"{descriptor.Kind}\"{allowedValues}");
        }

        if (descriptor.Kind == "reference")
        {
            var referenced = await ReadOwnObjectAsync(context, value.GetGuid());
            if (referenced is null)
            {
                throw new ChangesetRejectedException($"свойство \"{propertyName}\" ссылается на несуществующий объект.");
            }
            if (descriptor.TargetTypes is { } targetTypes && !targetTypes.Contains(referenced.Type))
            {
                throw new ChangesetRejectedException(
                    $"свойство \"{propertyName}\" не может ссылаться на объект типа \"{referenced.Type}\".");
            }
        }
    }

    private static Guid? ReadGuid(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && value.TryGetGuid(out var id)
            ? id
            : null;

    private static JsonElement GuidToJson(Guid id) => JsonSerializer.Deserialize<JsonElement>($"\"{id}\"");

    /// <summary>
    /// Сравнение значений свойств; <c>default</c> (Undefined) и JSON null считаются «пусто»
    /// </summary>
    private static bool ValuesEqual(JsonElement left, JsonElement right)
    {
        static bool IsEmpty(JsonElement element) => element.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null;

        if (IsEmpty(left) || IsEmpty(right))
        {
            return IsEmpty(left) && IsEmpty(right);
        }
        if (left.ValueKind != right.ValueKind)
        {
            return false;
        }
        return left.ValueKind switch
        {
            JsonValueKind.String => left.GetString() == right.GetString(),
            JsonValueKind.Number => left.GetDecimal() == right.GetDecimal(),
            _ => true,
        };
    }

    private static Task WriteJournalAsync(
        ChangesetContext context, Guid objectId, string typeId, string operation, string? property,
        JsonNode? old, JsonNode? @new, JsonNode? snapshot) =>
        context.ExecuteAsync(
            """
            insert into changeset_entries (changeset_id, seq, object_id, type_id, operation, property, old_value, new_value, snapshot)
            values (@changesetId, @seq, @objectId, @typeId, @operation, @property, @old, @new, @snapshot)
            """,
            new
            {
                changesetId = context.ChangesetId,
                seq = context.NextEntrySequence(),
                objectId,
                typeId,
                operation,
                property,
                old = ToJsonElement(old),
                @new = ToJsonElement(@new),
                snapshot = ToJsonElement(snapshot),
            });

    private static JsonElement? ToJsonElement(JsonNode? node) =>
        node is null ? null : JsonSerializer.Deserialize<JsonElement>(node.ToJsonString());

    /// <summary>
    /// Соединение, транзакция и общие данные применяемого набора
    /// </summary>
    private sealed class ChangesetContext(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid userId,
        Guid changesetId,
        IReadOnlyDictionary<string, TypeDescriptor> types,
        IReadOnlySet<string> disabledExtensions,
        CancellationToken cancellationToken)
    {
        private int entrySequence;

        public Guid UserId { get; } = userId;
        public Guid ChangesetId { get; } = changesetId;
        public IReadOnlyDictionary<string, TypeDescriptor> Types { get; } = types;

        /// <summary>
        /// Расширения, отключённые у пользователя: запись в их типы запрещена
        /// </summary>
        public IReadOnlySet<string> DisabledExtensions { get; } = disabledExtensions;

        /// <summary>
        /// Сквозной номер записи журнала внутри набора (одна операция может дать несколько записей)
        /// </summary>
        public int NextEntrySequence() => ++entrySequence;

        public Task<int> ExecuteAsync(string sql, object parameters) =>
            connection.ExecuteAsync(Command(sql, parameters));

        public Task<T> ScalarAsync<T>(string sql, object parameters) =>
            connection.ExecuteScalarAsync<T>(Command(sql, parameters))!;

        public Task<T?> QueryOneAsync<T>(string sql, object parameters) =>
            connection.QuerySingleOrDefaultAsync<T>(Command(sql, parameters));

        private CommandDefinition Command(string sql, object parameters) =>
            new(sql, parameters, transaction, cancellationToken: cancellationToken);
    }

    private sealed record PropertyDescriptor(string Kind, HashSet<string>? Values, HashSet<string>? TargetTypes);

    /// <summary>
    /// Описание типа из манифеста, нужное для проверок набора
    /// </summary>
    private sealed class TypeDescriptor
    {
        public TypeDescriptor(string id, string? extensionId, JsonElement definition)
        {
            Id = id;
            ExtensionId = extensionId;
            IsAbstract = definition.TryGetProperty("abstract", out var abstractElement)
                && abstractElement.ValueKind == JsonValueKind.True;
            IsSingleton = definition.TryGetProperty("singleton", out var singletonElement)
                && singletonElement.ValueKind == JsonValueKind.True;
            if (definition.TryGetProperty("allowedChildren", out var children) && children.ValueKind == JsonValueKind.Array)
            {
                AllowedChildren = children.EnumerateArray().Select(child => child.GetString() ?? "").ToHashSet();
            }
            if (definition.TryGetProperty("properties", out var properties) && properties.ValueKind == JsonValueKind.Array)
            {
                foreach (var property in properties.EnumerateArray())
                {
                    HashSet<string>? values = property.TryGetProperty("values", out var valuesElement)
                        ? valuesElement.EnumerateArray().Select(v => v.GetProperty("value").GetString() ?? "").ToHashSet()
                        : null;
                    HashSet<string>? targetTypes = property.TryGetProperty("targetTypes", out var targetsElement)
                        ? targetsElement.EnumerateArray().Select(t => t.GetString() ?? "").ToHashSet()
                        : null;
                    var propertyId = property.GetProperty("id").GetString() ?? "";
                    Properties[propertyId] = new PropertyDescriptor(
                        property.GetProperty("kind").GetString() ?? "", values, targetTypes);
                }
            }
        }

        public string Id { get; }

        /// <summary>
        /// Расширение, объявившее тип; <c>null</c> — тип платформы
        /// </summary>
        public string? ExtensionId { get; }

        public bool IsAbstract { get; }

        /// <summary>
        /// У одного родителя и владельца допускается не больше одного объекта типа
        /// </summary>
        public bool IsSingleton { get; }

        /// <summary>
        /// <c>null</c>: ограничений нет (список allowedChildren в манифесте не задан)
        /// </summary>
        public HashSet<string>? AllowedChildren { get; }

        public Dictionary<string, PropertyDescriptor> Properties { get; } = [];
    }
}
