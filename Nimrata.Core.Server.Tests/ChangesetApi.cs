using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Nimrata.Core.Server.Tests;

/// <summary>
/// Результат одного набора в ответе пакетной записи <c>POST /api/changesets</c>
/// </summary>
/// <param name="Id">Идентификатор набора, присланный клиентом</param>
/// <param name="Status">Итог: <c>applied</c>, <c>duplicate</c> или <c>rejected</c></param>
/// <param name="Seq">Курсор применённого набора; у отклонённого отсутствует</param>
/// <param name="PrevSeq">Курсор предыдущего набора того же пользователя; у отклонённого отсутствует</param>
/// <param name="Code">Машинный код отказа, если он есть</param>
/// <param name="Detail">Причина отказа для пользователя</param>
public sealed record ChangesetOutcome(Guid Id, string Status, long? Seq, long? PrevSeq, string? Code, string? Detail)
{
    /// <summary>
    /// Набор применён сервером
    /// </summary>
    public bool IsApplied => Status == "applied";
}

/// <summary>
/// Отправка наборов изменений в тестах: тело пакета, разбор ответа и проверки отказа
/// </summary>
public static class ChangesetApi
{
    /// <summary>
    /// Отправляет один набор с новым идентификатором и возвращает его результат
    /// </summary>
    /// <param name="client">Клиент HTTP с токеном пользователя</param>
    /// <param name="operations">Операции набора</param>
    /// <returns>Результат набора; ответ HTTP обязан быть 200</returns>
    public static async Task<ChangesetOutcome> ApplyAsync(HttpClient client, params object[] operations) =>
        (await ApplyManyAsync(client, (Guid.CreateVersion7(), operations))).Single();

    /// <summary>
    /// Отправляет пакет наборов с заданными идентификаторами
    /// </summary>
    /// <param name="client">Клиент HTTP с токеном пользователя</param>
    /// <param name="changesets">Наборы: идентификатор и операции</param>
    /// <returns>Результаты наборов в порядке отправки; ответ HTTP обязан быть 200</returns>
    public static async Task<ChangesetOutcome[]> ApplyManyAsync(
        HttpClient client, params (Guid Id, object[] Operations)[] changesets)
    {
        var response = await client.PostAsJsonAsync(
            "/api/changesets",
            new { changesets = changesets.Select(c => new { id = c.Id, operations = c.Operations }) });
        Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<ChangesetOutcome[]>(JsonSerializerOptions.Web))!;
    }

    /// <summary>
    /// Проверяет, что набор применён
    /// </summary>
    /// <param name="outcome">Результат набора</param>
    public static void AssertApplied(ChangesetOutcome outcome) =>
        Assert.True(outcome.IsApplied, $"{outcome.Status}: {outcome.Detail}");

    /// <summary>
    /// Проверяет, что набор отклонён и причина содержит фрагмент
    /// </summary>
    /// <param name="outcome">Результат набора</param>
    /// <param name="substring">Фрагмент причины; пустая строка — любой текст</param>
    /// <param name="code">Ожидаемый машинный код; <c>null</c> — не проверяется</param>
    public static void AssertRejected(ChangesetOutcome outcome, string substring, string? code = null)
    {
        Assert.Equal("rejected", outcome.Status);
        Assert.Null(outcome.Seq);
        Assert.Contains(substring, outcome.Detail);
        if (code is not null)
        {
            Assert.Equal(code, outcome.Code);
        }
    }
}
