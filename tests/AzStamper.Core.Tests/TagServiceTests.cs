using Azure;
using AzStamper.Core.Services;
using Microsoft.Extensions.Logging;
using Moq;

namespace AzStamper.Core.Tests;

public class TagServiceTests
{
    private readonly Mock<IArmTagClient> _armTagClientMock;
    private readonly Mock<ILogger<TagService>> _loggerMock;
    private readonly TagService _sut;

    private const string ResourceId =
        "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Compute/virtualMachines/vm-test";

    public TagServiceTests()
    {
        _armTagClientMock = new Mock<IArmTagClient>();
        _loggerMock = new Mock<ILogger<TagService>>();
        _sut = new TagService(_armTagClientMock.Object, _loggerMock.Object);
    }

    // ── GetTagsAsync ──────────────────────────────────────────────────────────

    [Fact]
    public async Task GetTagsAsync_WhenClientReturnsTags_ReturnsDictionary()
    {
        // Arrange
        var expected = new Dictionary<string, string>
        {
            ["Environment"] = "Production",
            ["Owner"] = "team@example.com"
        };

        _armTagClientMock
            .Setup(c => c.GetTagsAsync(ResourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(expected);

        // Act
        var result = await _sut.GetTagsAsync(ResourceId);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(expected, result);
    }

    [Fact]
    public async Task GetTagsAsync_WhenRequestFailedExceptionThrown_ReturnsNull()
    {
        // Arrange
        _armTagClientMock
            .Setup(c => c.GetTagsAsync(ResourceId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new RequestFailedException("ARM API unavailable"));

        // Act
        var result = await _sut.GetTagsAsync(ResourceId);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetTagsAsync_WhenRequestFailedExceptionThrown_LogsWarning()
    {
        // Arrange
        var expectedException = new RequestFailedException("ARM API unavailable");

        _armTagClientMock
            .Setup(c => c.GetTagsAsync(ResourceId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(expectedException);

        // Act
        await _sut.GetTagsAsync(ResourceId);

        // Assert
        _loggerMock.Verify(
            l => l.Log(
                LogLevel.Warning,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains(ResourceId)),
                expectedException,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    // ── SetTagsAsync ──────────────────────────────────────────────────────────

    [Fact]
    public async Task SetTagsAsync_WhenClientSucceeds_ReturnsTrue()
    {
        // Arrange
        var tags = new Dictionary<string, string> { ["CreatedBy"] = "az-stamper" };

        _armTagClientMock
            .Setup(c => c.SetTagsAsync(ResourceId, tags, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await _sut.SetTagsAsync(ResourceId, tags);

        // Assert
        Assert.True(result);
    }

    [Fact]
    public async Task SetTagsAsync_WhenRequestFailedExceptionThrown_ReturnsFalse()
    {
        // Arrange
        var tags = new Dictionary<string, string> { ["CreatedBy"] = "az-stamper" };

        _armTagClientMock
            .Setup(c => c.SetTagsAsync(ResourceId, tags, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new RequestFailedException("ARM write failed"));

        // Act
        var result = await _sut.SetTagsAsync(ResourceId, tags);

        // Assert
        Assert.False(result);
    }

    [Fact]
    public async Task SetTagsAsync_WhenRequestFailedExceptionThrown_LogsWarning()
    {
        // Arrange
        var tags = new Dictionary<string, string> { ["CreatedBy"] = "az-stamper" };
        var expectedException = new RequestFailedException("ARM write failed");

        _armTagClientMock
            .Setup(c => c.SetTagsAsync(ResourceId, tags, It.IsAny<CancellationToken>()))
            .ThrowsAsync(expectedException);

        // Act
        await _sut.SetTagsAsync(ResourceId, tags);

        // Assert
        _loggerMock.Verify(
            l => l.Log(
                LogLevel.Warning,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains(ResourceId)),
                expectedException,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }
}
