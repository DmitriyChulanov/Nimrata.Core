using System.Text.Json;

namespace Nimrata.Core.Server.Modules;

/// <summary>Проверка формата манифеста модуля. Возвращает список понятных ошибок с путями.</summary>
public static class ManifestValidator
{
    public static readonly string[] Kinds = ["string", "text", "integer", "boolean", "date", "time", "enum", "reference"];
    public static readonly string[] Placements = ["automation", "propertyGrid", "contextMenu"];

    public static List<string> Validate(JsonElement корень)
    {
        var ошибки = new List<string>();
        if (корень.ValueKind != JsonValueKind.Object)
        {
            ошибки.Add("корень манифеста должен быть объектом");
            return ошибки;
        }

        НужнаяСтрока(корень, "module", "$", ошибки);
        if (!корень.TryGetProperty("version", out var версия) || версия.ValueKind != JsonValueKind.Number
            || !версия.TryGetInt32(out var в) || в < 1)
        {
            ошибки.Add("$.version: нужно целое число не меньше 1");
        }

        if (!корень.TryGetProperty("types", out var типы) || типы.ValueKind != JsonValueKind.Array)
        {
            ошибки.Add("$.types: нужен массив типов");
            return ошибки;
        }

        var ид = new HashSet<string>();
        foreach (var тип in типы.EnumerateArray())
        {
            if (тип.ValueKind == JsonValueKind.Object && тип.TryGetProperty("id", out var i)
                && i.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(i.GetString()))
            {
                if (!ид.Add(i.GetString()!)) ошибки.Add($"$.types: идентификатор типа \"{i.GetString()}\" повторяется");
            }
        }

        var n = 0;
        foreach (var тип in типы.EnumerateArray())
        {
            ПроверитьТип(тип, $"$.types[{n++}]", ид, ошибки);
        }
        return ошибки;
    }

    private static void ПроверитьТип(JsonElement тип, string путь, HashSet<string> ид, List<string> ошибки)
    {
        if (тип.ValueKind != JsonValueKind.Object)
        {
            ошибки.Add($"{путь}: тип должен быть объектом");
            return;
        }
        НужнаяСтрока(тип, "id", путь, ошибки);
        НужнаяСтрока(тип, "name", путь, ошибки);
        foreach (var флаг in new[] { "abstract", "sealed", "hiddenInTree", "automation" })
        {
            if (тип.TryGetProperty(флаг, out var ф) && ф.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                ошибки.Add($"{путь}.{флаг}: нужно логическое значение");
        }
        if (Флаг(тип, "abstract") && Флаг(тип, "sealed"))
            ошибки.Add($"{путь}: тип не может быть одновременно abstract и sealed");

        if (тип.TryGetProperty("allowedChildren", out var дети))
        {
            if (дети.ValueKind != JsonValueKind.Array) ошибки.Add($"{путь}.allowedChildren: нужен массив");
            else
                foreach (var ребёнок in дети.EnumerateArray())
                {
                    if (ребёнок.ValueKind != JsonValueKind.String || !ид.Contains(ребёнок.GetString()!))
                        ошибки.Add($"{путь}.allowedChildren: неизвестный тип \"{ребёнок}\"");
                }
        }

        var свойства = new HashSet<string>();
        if (тип.TryGetProperty("properties", out var список))
        {
            if (список.ValueKind != JsonValueKind.Array) ошибки.Add($"{путь}.properties: нужен массив");
            else
            {
                var n = 0;
                foreach (var свойство in список.EnumerateArray())
                    ПроверитьСвойство(свойство, $"{путь}.properties[{n++}]", свойства, ид, ошибки);
            }
        }

        if (тип.TryGetProperty("actions", out var действия))
        {
            if (действия.ValueKind != JsonValueKind.Array) ошибки.Add($"{путь}.actions: нужен массив");
            else
            {
                var n = 0;
                var идДействий = new HashSet<string>();
                foreach (var действие in действия.EnumerateArray())
                    ПроверитьДействие(действие, $"{путь}.actions[{n++}]", идДействий, ид, ошибки);
            }
        }

        if (тип.TryGetProperty("colorRules", out var правила))
        {
            if (правила.ValueKind != JsonValueKind.Array) ошибки.Add($"{путь}.colorRules: нужен массив");
            else
            {
                var n = 0;
                foreach (var правило in правила.EnumerateArray())
                {
                    var п = $"{путь}.colorRules[{n++}]";
                    if (правило.ValueKind != JsonValueKind.Object) { ошибки.Add($"{п}: правило должно быть объектом"); continue; }
                    НужнаяСтрока(правило, "color", п, ошибки);
                    if (!правило.TryGetProperty("equals", out _)) ошибки.Add($"{п}.equals: значение обязательно");
                    if (!правило.TryGetProperty("property", out var имя) || имя.ValueKind != JsonValueKind.String
                        || !свойства.Contains(имя.GetString()!))
                        ошибки.Add($"{п}.property: свойство \"{имя}\" не объявлено в типе");
                }
            }
        }
    }

    private static void ПроверитьСвойство(JsonElement свойство, string путь, HashSet<string> занятые,
        HashSet<string> ид, List<string> ошибки)
    {
        if (свойство.ValueKind != JsonValueKind.Object) { ошибки.Add($"{путь}: свойство должно быть объектом"); return; }
        НужнаяСтрока(свойство, "name", путь, ошибки);
        if (НужнаяСтрока(свойство, "id", путь, ошибки) is { } имя && !занятые.Add(имя))
            ошибки.Add($"{путь}.id: свойство \"{имя}\" повторяется");

        var вид = НужнаяСтрока(свойство, "kind", путь, ошибки);
        if (вид is not null && !Kinds.Contains(вид))
            ошибки.Add($"{путь}.kind: неизвестный вид \"{вид}\" (допустимо: {string.Join(", ", Kinds)})");

        if (вид == "enum")
        {
            if (!свойство.TryGetProperty("values", out var значения) || значения.ValueKind != JsonValueKind.Array
                || значения.GetArrayLength() == 0)
            {
                ошибки.Add($"{путь}.values: для вида enum нужен непустой список значений");
            }
            else
            {
                var занятыеЗначения = new HashSet<string>();
                var n = 0;
                foreach (var значение in значения.EnumerateArray())
                {
                    var п = $"{путь}.values[{n++}]";
                    if (значение.ValueKind != JsonValueKind.Object) { ошибки.Add($"{п}: нужен объект {{value, name}}"); continue; }
                    НужнаяСтрока(значение, "name", п, ошибки);
                    if (НужнаяСтрока(значение, "value", п, ошибки) is { } в && !занятыеЗначения.Add(в))
                        ошибки.Add($"{п}.value: значение \"{в}\" повторяется");
                }
            }
        }
        else if (свойство.TryGetProperty("values", out _))
        {
            ошибки.Add($"{путь}.values: список значений допустим только для вида enum");
        }

        if (свойство.TryGetProperty("revealTarget", out var показать))
        {
            if (показать.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                ошибки.Add($"{путь}.revealTarget: нужно логическое значение");
            else if (вид != "reference")
                ошибки.Add($"{путь}.revealTarget: допустим только для вида reference");
        }

        if (вид == "reference" && свойство.TryGetProperty("targetTypes", out var цели))
        {
            if (цели.ValueKind != JsonValueKind.Array) ошибки.Add($"{путь}.targetTypes: нужен массив");
            else
                foreach (var цель in цели.EnumerateArray())
                    if (цель.ValueKind != JsonValueKind.String || !ид.Contains(цель.GetString()!))
                        ошибки.Add($"{путь}.targetTypes: неизвестный тип \"{цель}\"");
        }
    }

    private static void ПроверитьДействие(JsonElement действие, string путь, HashSet<string> занятые,
        HashSet<string> ид, List<string> ошибки)
    {
        if (действие.ValueKind != JsonValueKind.Object) { ошибки.Add($"{путь}: действие должно быть объектом"); return; }
        НужнаяСтрока(действие, "name", путь, ошибки);
        if (НужнаяСтрока(действие, "id", путь, ошибки) is { } имя && !занятые.Add(имя))
            ошибки.Add($"{путь}.id: действие \"{имя}\" повторяется");

        if (действие.TryGetProperty("placements", out var места))
        {
            if (места.ValueKind != JsonValueKind.Array) ошибки.Add($"{путь}.placements: нужен массив");
            else
                foreach (var место in места.EnumerateArray())
                    if (место.ValueKind != JsonValueKind.String || !Placements.Contains(место.GetString()))
                        ошибки.Add($"{путь}.placements: неизвестное место \"{место}\" (допустимо: {string.Join(", ", Placements)})");
        }

        if (действие.TryGetProperty("parameters", out var параметры))
        {
            if (параметры.ValueKind != JsonValueKind.Array) ошибки.Add($"{путь}.parameters: нужен массив");
            else
            {
                var занятыеПараметры = new HashSet<string>();
                var n = 0;
                foreach (var параметр in параметры.EnumerateArray())
                    ПроверитьСвойство(параметр, $"{путь}.parameters[{n++}]", занятыеПараметры, ид, ошибки);
            }
        }
    }

    private static bool Флаг(JsonElement объект, string имя) =>
        объект.TryGetProperty(имя, out var з) && з.ValueKind == JsonValueKind.True;

    private static string? НужнаяСтрока(JsonElement объект, string имя, string путь, List<string> ошибки)
    {
        if (объект.TryGetProperty(имя, out var з) && з.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(з.GetString()))
        {
            return з.GetString();
        }
        ошибки.Add($"{путь}.{имя}: нужна непустая строка");
        return null;
    }
}
