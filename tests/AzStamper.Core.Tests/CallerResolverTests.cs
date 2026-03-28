using AzStamper.Core.Services;
using Microsoft.Extensions.Logging;
using Moq;

namespace AzStamper.Core.Tests;

public class CallerResolverTests
{
    private readonly Mock<IGraphServicePrincipalClient> _graphClientMock;
    private readonly Mock<ILogger<CallerResolver>> _loggerMock;
    private readonly CallerResolver _sut;

    public CallerResolverTests()
    {
        _graphClientMock = new Mock<IGraphServicePrincipalClient>();
        _loggerMock = new Mock<ILogger<CallerResolver>>();
        _sut = new CallerResolver(_graphClientMock.Object, _loggerMock.Object);
    }

    [Fact]
    public async Task ResolveDisplayNameAsync_WhenSpFound_ReturnsDisplayName()
    {
        // Arrange
        const string principalId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        const string expectedName = "My Service Principal";

        _graphClientMock
            .Setup(c => c.GetDisplayNameAsync(principalId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(expectedName);

        // Act
        var result = await _sut.ResolveDisplayNameAsync(principalId);

        // Assert
        Assert.Equal(expectedName, result);
    }

    [Fact]
    public async Task ResolveDisplayNameAsync_WhenSpNotFound_ReturnsNull()
    {
        // Arrange
        const string principalId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

        _graphClientMock
            .Setup(c => c.GetDisplayNameAsync(principalId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);

        // Act
        var result = await _sut.ResolveDisplayNameAsync(principalId);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task ResolveDisplayNameAsync_WhenExceptionThrown_ReturnsNull()
    {
        // Arrange
        const string principalId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

        _graphClientMock
            .Setup(c => c.GetDisplayNameAsync(principalId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new Exception("Graph API unavailable"));

        // Act
        var result = await _sut.ResolveDisplayNameAsync(principalId);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task ResolveDisplayNameAsync_WhenExceptionThrown_LogsWarning()
    {
        // Arrange
        const string principalId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        var expectedException = new Exception("Graph API unavailable");

        _graphClientMock
            .Setup(c => c.GetDisplayNameAsync(principalId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(expectedException);

        // Act
        await _sut.ResolveDisplayNameAsync(principalId);

        // Assert
        _loggerMock.Verify(
            l => l.Log(
                LogLevel.Warning,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains(principalId)),
                expectedException,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }
}
