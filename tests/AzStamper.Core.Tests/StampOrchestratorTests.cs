using AzStamper.Core.Models;
using AzStamper.Core.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;

namespace AzStamper.Core.Tests;

public class StampOrchestratorTests
{
    private readonly Mock<ICallerResolver> _callerResolver;
    private readonly Mock<ITagService> _tagService;
    private readonly Mock<ISubscriptionConfigProvider> _configProvider;
    private readonly Mock<ILogger<StampOrchestrator>> _logger;

    private static readonly StamperConfig DefaultConfig = new()
    {
        TagMap = new Dictionary<string, TagEntry>
        {
            ["Creator"] = new() { Value = "{caller}", Overwrite = false },
            ["CreatedOn"] = new() { Value = "{timestamp}", Overwrite = false },
            ["LastModifiedBy"] = new() { Value = "{caller}", Overwrite = true },
            ["StampedBy"] = new() { Value = "Az-Stamper", Overwrite = false }
        },
        IgnorePatterns = new List<string>
        {
            "Microsoft.Resources/deployments",
            "Microsoft.Resources/tags"
        }
    };

    public StampOrchestratorTests()
    {
        _callerResolver = new Mock<ICallerResolver>();
        _tagService = new Mock<ITagService>();
        _configProvider = new Mock<ISubscriptionConfigProvider>();
        _logger = new Mock<ILogger<StampOrchestrator>>();
    }

    private StampOrchestrator CreateOrchestrator(StamperConfig? config = null)
    {
        var options = Options.Create(config ?? DefaultConfig);
        var configResolver = new ConfigResolver(options);
        return new StampOrchestrator(
            _callerResolver.Object,
            _tagService.Object,
            options,
            configResolver,
            _configProvider.Object,
            _logger.Object);
    }

    [Fact]
    public async Task SkipsWhenResourceIdIsNull()
    {
        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = null, Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task SkipsWhenResourceIdIsEmpty()
    {
        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = "", Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task SkipsIgnoredResourceTypes()
    {
        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Resources/deployments/myDeployment",
            Caller = "alice@contoso.com"
        };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task UsesCallerDirectly_WhenCallerIsSet()
    {
        var resourceId = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
        _tagService
            .Setup(x => x.GetTagsAsync(resourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagService
            .Setup(x => x.SetTagsAsync(resourceId, It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = resourceId, Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(
            resourceId,
            It.Is<Dictionary<string, string>>(d => d.ContainsKey("Creator") && d["Creator"] == "alice@contoso.com"),
            It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task ResolvesServicePrincipal_WhenCallerIsNull()
    {
        var resourceId = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
        _callerResolver
            .Setup(x => x.ResolveDisplayNameAsync("sp-id-123", It.IsAny<CancellationToken>()))
            .ReturnsAsync("My Service Principal");
        _tagService
            .Setup(x => x.GetTagsAsync(resourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagService
            .Setup(x => x.SetTagsAsync(resourceId, It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent
        {
            ResourceId = resourceId,
            Caller = null,
            PrincipalType = "ServicePrincipal",
            PrincipalId = "sp-id-123"
        };

        await orchestrator.ProcessAsync(evt);

        _callerResolver.Verify(x => x.ResolveDisplayNameAsync("sp-id-123", It.IsAny<CancellationToken>()), Times.Once);
        _tagService.Verify(x => x.SetTagsAsync(
            resourceId,
            It.Is<Dictionary<string, string>>(d => d.ContainsKey("Creator") && d["Creator"] == "My Service Principal"),
            It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task FallsBackToPrincipalId_WhenResolverReturnsNull()
    {
        var resourceId = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
        _callerResolver
            .Setup(x => x.ResolveDisplayNameAsync("sp-id-123", It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
        _tagService
            .Setup(x => x.GetTagsAsync(resourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagService
            .Setup(x => x.SetTagsAsync(resourceId, It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent
        {
            ResourceId = resourceId,
            Caller = null,
            PrincipalType = "ServicePrincipal",
            PrincipalId = "sp-id-123"
        };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(
            resourceId,
            It.Is<Dictionary<string, string>>(d => d.ContainsKey("Creator") && d["Creator"] == "sp-id-123"),
            It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task SkipsWhenCallerCannotBeResolved()
    {
        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = null,
            PrincipalType = null,
            PrincipalId = null
        };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DoesNotOverwrite_ExistingCreatorTag()
    {
        var resourceId = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
        _tagService
            .Setup(x => x.GetTagsAsync(resourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>
            {
                ["Creator"] = "original-creator@contoso.com",
                ["CreatedOn"] = "2024-01-01T00:00:00Z"
            });
        _tagService
            .Setup(x => x.SetTagsAsync(resourceId, It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = resourceId, Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(
            resourceId,
            It.Is<Dictionary<string, string>>(d =>
                !d.ContainsKey("Creator") &&
                d.ContainsKey("LastModifiedBy") && d["LastModifiedBy"] == "alice@contoso.com"),
            It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task OverwritesLastModifiedBy_WhenOverwriteIsTrue()
    {
        var resourceId = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
        _tagService
            .Setup(x => x.GetTagsAsync(resourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>
            {
                ["LastModifiedBy"] = "previous-user@contoso.com"
            });
        _tagService
            .Setup(x => x.SetTagsAsync(resourceId, It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = resourceId, Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(
            resourceId,
            It.Is<Dictionary<string, string>>(d =>
                d.ContainsKey("LastModifiedBy") && d["LastModifiedBy"] == "alice@contoso.com"),
            It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task ResolvesTimestampVariable()
    {
        var resourceId = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
        _tagService
            .Setup(x => x.GetTagsAsync(resourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());

        Dictionary<string, string>? capturedTags = null;
        _tagService
            .Setup(x => x.SetTagsAsync(resourceId, It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .Callback<string, Dictionary<string, string>, CancellationToken>((_, tags, _) => capturedTags = tags)
            .ReturnsAsync(true);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = resourceId, Caller = "alice@contoso.com" };

        var before = DateTime.UtcNow;
        await orchestrator.ProcessAsync(evt);
        var after = DateTime.UtcNow;

        Assert.NotNull(capturedTags);
        Assert.True(capturedTags.ContainsKey("CreatedOn"), "CreatedOn tag should be present");
        var parsedDate = DateTime.Parse(capturedTags["CreatedOn"], null, System.Globalization.DateTimeStyles.RoundtripKind);
        Assert.True(parsedDate >= before.AddSeconds(-1) && parsedDate <= after.AddSeconds(1),
            $"Timestamp {capturedTags["CreatedOn"]} should be within the test window");
    }

    [Fact]
    public async Task ResolvesStaticValue()
    {
        var resourceId = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
        _tagService
            .Setup(x => x.GetTagsAsync(resourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagService
            .Setup(x => x.SetTagsAsync(resourceId, It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = resourceId, Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(
            resourceId,
            It.Is<Dictionary<string, string>>(d => d.ContainsKey("StampedBy") && d["StampedBy"] == "Az-Stamper"),
            It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task HandlesGetTagsFailure_Gracefully()
    {
        var resourceId = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
        _tagService
            .Setup(x => x.GetTagsAsync(resourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Dictionary<string, string>?)null);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = resourceId, Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task SkipsWhenNoTagsToApply()
    {
        var emptyConfig = new StamperConfig
        {
            TagMap = new Dictionary<string, TagEntry>(),
            IgnorePatterns = new List<string>()
        };

        var orchestrator = CreateOrchestrator(emptyConfig);
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = "alice@contoso.com"
        };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
