using System.Text.Json;

namespace Nimrata.Core.Server.Extensions;

/// <summary>
/// Проверка формата манифеста расширения. Возвращает список понятных ошибок с путями
/// </summary>
public static class ManifestValidator
{
    /// <summary>
    /// Допустимые виды свойств
    /// </summary>
    public static readonly string[] Kinds = ["string", "text", "integer", "boolean", "date", "time", "enum", "reference"];
    /// <summary>
    /// Допустимые места действий в интерфейсе
    /// </summary>
    public static readonly string[] Placements = ["propertyGrid", "contextMenu"];

    /// <summary>
    /// Проверяет корень манифеста
    /// </summary>
    /// <param name="root">Разобранный JSON манифеста</param>
    /// <param name="otherExtensionTypes">
    /// Типы других расширений (идентификатор типа и расширение): ссылка на них в <c>allowedChildren</c> запрещена
    /// </param>
    /// <returns>Ошибки с путями вида <c>$.types[0].id</c>; пустой список, если манифест валиден</returns>
    public static List<string> Validate(JsonElement root, IReadOnlyDictionary<string, string>? otherExtensionTypes = null)
    {
        var errors = new List<string>();
        if (root.ValueKind != JsonValueKind.Object)
        {
            errors.Add("корень манифеста должен быть объектом");
            return errors;
        }

        RequireString(root, "extension", "$", errors);
        RequireString(root, "name", "$", errors);
        RequireString(root, "description", "$", errors);
        RequireString(root, "icon", "$", errors);
        if (!root.TryGetProperty("defaultEnabled", out var defaultEnabled)
            || defaultEnabled.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            errors.Add("$.defaultEnabled: нужно логическое значение");
        }
        if (!root.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number
            || !version.TryGetInt32(out var intVersion) || intVersion < 1)
        {
            errors.Add("$.version: нужно целое число не меньше 1");
        }

        if (!root.TryGetProperty("types", out var types) || types.ValueKind != JsonValueKind.Array)
        {
            errors.Add("$.types: нужен массив типов");
            return errors;
        }

        var typeIds = new HashSet<string>();
        foreach (var type in types.EnumerateArray())
        {
            if (type.ValueKind == JsonValueKind.Object && type.TryGetProperty("id", out var i)
                && i.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(i.GetString()))
            {
                if (!typeIds.Add(i.GetString()!)) errors.Add($"$.types: идентификатор типа \"{i.GetString()}\" повторяется");
            }
        }

        var n = 0;
        foreach (var type in types.EnumerateArray())
        {
            ValidateType(type, $"$.types[{n++}]", typeIds, otherExtensionTypes, errors);
        }

        ValidateCommands(root, typeIds, errors);
        return errors;
    }

    /// <summary>
    /// Проверяет необязательную секцию <c>commands</c>: уникальные идентификаторы, название, значок,
    /// описание, признак шаблона и параметры по правилам параметров действий
    /// </summary>
    private static void ValidateCommands(JsonElement root, HashSet<string> typeIds, List<string> errors)
    {
        if (!root.TryGetProperty("commands", out var commands)) return;
        if (commands.ValueKind != JsonValueKind.Array)
        {
            errors.Add("$.commands: нужен массив");
            return;
        }

        var taken = new HashSet<string>();
        var n = 0;
        foreach (var command in commands.EnumerateArray())
        {
            var path = $"$.commands[{n++}]";
            if (command.ValueKind != JsonValueKind.Object) { errors.Add($"{path}: команда должна быть объектом"); continue; }
            if (RequireString(command, "id", path, errors) is { } id && !taken.Add(id))
                errors.Add($"{path}.id: команда \"{id}\" повторяется");
            RequireString(command, "name", path, errors);
            RequireString(command, "icon", path, errors);
            if (command.TryGetProperty("description", out var description) && description.ValueKind != JsonValueKind.String)
                errors.Add($"{path}.description: нужна строка");
            if (command.TryGetProperty("template", out var template)
                && template.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                errors.Add($"{path}.template: нужно логическое значение");
            ValidateParameters(command, path, typeIds, errors);
        }
    }

    private static void ValidateType(JsonElement type, string path, HashSet<string> typeIds,
        IReadOnlyDictionary<string, string>? otherExtensionTypes, List<string> errors)
    {
        if (type.ValueKind != JsonValueKind.Object)
        {
            errors.Add($"{path}: тип должен быть объектом");
            return;
        }
        RequireString(type, "id", path, errors);
        RequireString(type, "name", path, errors);
        foreach (var flag in new[] { "abstract", "sealed", "hiddenInTree", "singleton" })
        {
            if (type.TryGetProperty(flag, out var flagValue) && flagValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                errors.Add($"{path}.{flag}: нужно логическое значение");
        }
        if (type.TryGetProperty("automation", out _))
            errors.Add($"{path}.automation: флаг упразднён, автоматизация описывается командами (commands) расширения");
        if (IsTrue(type, "abstract") && IsTrue(type, "sealed"))
            errors.Add($"{path}: тип не может быть одновременно abstract и sealed");

        if (type.TryGetProperty("allowedChildren", out var children))
        {
            if (children.ValueKind != JsonValueKind.Array) errors.Add($"{path}.allowedChildren: нужен массив");
            else
                foreach (var child in children.EnumerateArray())
                {
                    if (child.ValueKind == JsonValueKind.String && !typeIds.Contains(child.GetString()!)
                        && otherExtensionTypes is not null && otherExtensionTypes.TryGetValue(child.GetString()!, out var owner))
                    {
                        errors.Add($"{path}.allowedChildren: тип \"{child}\" принадлежит другому расширению \"{owner}\"");
                    }
                    else if (child.ValueKind != JsonValueKind.String || !typeIds.Contains(child.GetString()!))
                    {
                        errors.Add($"{path}.allowedChildren: неизвестный тип \"{child}\"");
                    }
                }
        }

        var propertyIds = new HashSet<string>();
        if (type.TryGetProperty("properties", out var list))
        {
            if (list.ValueKind != JsonValueKind.Array) errors.Add($"{path}.properties: нужен массив");
            else
            {
                var n = 0;
                foreach (var property in list.EnumerateArray())
                    ValidateProperty(property, $"{path}.properties[{n++}]", propertyIds, typeIds, errors);
            }
        }

        if (type.TryGetProperty("actions", out var actions))
        {
            if (actions.ValueKind != JsonValueKind.Array) errors.Add($"{path}.actions: нужен массив");
            else
            {
                var n = 0;
                var actionIds = new HashSet<string>();
                foreach (var action in actions.EnumerateArray())
                    ValidateAction(action, $"{path}.actions[{n++}]", actionIds, typeIds, errors);
            }
        }

        if (type.TryGetProperty("colorRules", out var rules))
        {
            if (rules.ValueKind != JsonValueKind.Array) errors.Add($"{path}.colorRules: нужен массив");
            else
            {
                var n = 0;
                foreach (var rule in rules.EnumerateArray())
                {
                    var itemPath = $"{path}.colorRules[{n++}]";
                    if (rule.ValueKind != JsonValueKind.Object) { errors.Add($"{itemPath}: правило должно быть объектом"); continue; }
                    RequireString(rule, "color", itemPath, errors);
                    if (!rule.TryGetProperty("equals", out _)) errors.Add($"{itemPath}.equals: значение обязательно");
                    if (!rule.TryGetProperty("property", out var name) || name.ValueKind != JsonValueKind.String
                        || !propertyIds.Contains(name.GetString()!))
                        errors.Add($"{itemPath}.property: свойство \"{name}\" не объявлено в типе");
                }
            }
        }
    }

    private static void ValidateProperty(JsonElement property, string path, HashSet<string> taken,
        HashSet<string> typeIds, List<string> errors)
    {
        if (property.ValueKind != JsonValueKind.Object) { errors.Add($"{path}: свойство должно быть объектом"); return; }
        RequireString(property, "name", path, errors);
        if (RequireString(property, "id", path, errors) is { } name && !taken.Add(name))
            errors.Add($"{path}.id: свойство \"{name}\" повторяется");

        var kind = RequireString(property, "kind", path, errors);
        if (kind is not null && !Kinds.Contains(kind))
            errors.Add($"{path}.kind: неизвестный вид \"{kind}\" (допустимо: {string.Join(", ", Kinds)})");

        ValidateOrder(property, path, errors);

        if (kind == "enum")
        {
            if (!property.TryGetProperty("values", out var values) || values.ValueKind != JsonValueKind.Array
                || values.GetArrayLength() == 0)
            {
                errors.Add($"{path}.values: для вида enum нужен непустой список значений");
            }
            else
            {
                var takenValues = new HashSet<string>();
                var n = 0;
                foreach (var value in values.EnumerateArray())
                {
                    var itemPath = $"{path}.values[{n++}]";
                    if (value.ValueKind != JsonValueKind.Object) { errors.Add($"{itemPath}: нужен объект {{value, name}}"); continue; }
                    RequireString(value, "name", itemPath, errors);
                    if (RequireString(value, "value", itemPath, errors) is { } intVersion && !takenValues.Add(intVersion))
                        errors.Add($"{itemPath}.value: значение \"{intVersion}\" повторяется");
                }
            }
        }
        else if (property.TryGetProperty("values", out _))
        {
            errors.Add($"{path}.values: список значений допустим только для вида enum");
        }

        if (property.TryGetProperty("revealTarget", out var reveal))
        {
            if (reveal.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                errors.Add($"{path}.revealTarget: нужно логическое значение");
            else if (kind != "reference")
                errors.Add($"{path}.revealTarget: допустим только для вида reference");
        }

        if (kind == "reference" && property.TryGetProperty("targetTypes", out var targets))
        {
            if (targets.ValueKind != JsonValueKind.Array) errors.Add($"{path}.targetTypes: нужен массив");
            else
                foreach (var target in targets.EnumerateArray())
                    if (target.ValueKind != JsonValueKind.String || !typeIds.Contains(target.GetString()!))
                        errors.Add($"{path}.targetTypes: неизвестный тип \"{target}\"");
        }
    }

    private static void ValidateAction(JsonElement action, string path, HashSet<string> taken,
        HashSet<string> typeIds, List<string> errors)
    {
        if (action.ValueKind != JsonValueKind.Object) { errors.Add($"{path}: действие должно быть объектом"); return; }
        RequireString(action, "name", path, errors);
        if (RequireString(action, "id", path, errors) is { } name && !taken.Add(name))
            errors.Add($"{path}.id: действие \"{name}\" повторяется");
        if (action.TryGetProperty("icon", out var icon) && icon.ValueKind != JsonValueKind.String)
            errors.Add($"{path}.icon: нужна строка с именем иконки");
        if (action.TryGetProperty("category", out var category) && category.ValueKind != JsonValueKind.String)
            errors.Add($"{path}.category: нужна строка");
        ValidateOrder(action, path, errors);

        if (action.TryGetProperty("placements", out var placements))
        {
            if (placements.ValueKind != JsonValueKind.Array) errors.Add($"{path}.placements: нужен массив");
            else
                foreach (var placement in placements.EnumerateArray())
                    if (placement.ValueKind != JsonValueKind.String || !Placements.Contains(placement.GetString()))
                        errors.Add($"{path}.placements: неизвестное место \"{placement}\" (допустимо: {string.Join(", ", Placements)})");
        }

        ValidateParameters(action, path, typeIds, errors);
    }

    /// <summary>
    /// Проверяет необязательные <c>parameters</c> действия или команды как свойства
    /// </summary>
    private static void ValidateParameters(JsonElement owner, string path, HashSet<string> typeIds, List<string> errors)
    {
        if (!owner.TryGetProperty("parameters", out var parameters)) return;
        if (parameters.ValueKind != JsonValueKind.Array) errors.Add($"{path}.parameters: нужен массив");
        else
        {
            var takenParameters = new HashSet<string>();
            var n = 0;
            foreach (var parameter in parameters.EnumerateArray())
                ValidateProperty(parameter, $"{path}.parameters[{n++}]", takenParameters, typeIds, errors);
        }
    }

    /// <summary>
    /// Проверяет необязательный <c>order</c> свойства или действия: число сквозного порядка в таблице свойств
    /// </summary>
    private static void ValidateOrder(JsonElement owner, string path, List<string> errors)
    {
        if (owner.TryGetProperty("order", out var order) && order.ValueKind != JsonValueKind.Number)
            errors.Add($"{path}.order: нужно число");
    }

    private static bool IsTrue(JsonElement source, string name) =>
        source.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.True;

    private static string? RequireString(JsonElement source, string name, string path, List<string> errors)
    {
        if (source.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(element.GetString()))
        {
            return element.GetString();
        }
        errors.Add($"{path}.{name}: нужна непустая строка");
        return null;
    }
}
