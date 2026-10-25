using Nimrata.Core.Server.Controllers;

namespace Nimrata.Core.Server.Tests;

public class WeatherForecastControllerTests
{
    [Fact]
    public void Get_ReturnsFiveForecastsWithSummaries()
    {
        var controller = new WeatherForecastController();

        var forecasts = controller.Get().ToArray();

        Assert.Equal(5, forecasts.Length);
        Assert.All(forecasts, f => Assert.False(string.IsNullOrEmpty(f.Summary)));
    }

    [Theory]
    [InlineData(0, 32)]
    [InlineData(100, 211)]
    public void TemperatureF_IsConvertedFromCelsius(int celsius, int expectedFahrenheit)
    {
        var forecast = new WeatherForecast { TemperatureC = celsius };

        Assert.Equal(expectedFahrenheit, forecast.TemperatureF);
    }
}
